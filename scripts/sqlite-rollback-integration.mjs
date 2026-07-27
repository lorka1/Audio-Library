import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { MongoClientManager } from '../src/lib/server/mongodb/client.ts';
import { readMongoConfig } from '../src/lib/server/mongodb/config.ts';
import { getMongoCollections } from '../src/lib/server/mongodb/collections.ts';
import { TRACK_PUBLIC_ID_COUNTER } from '../src/lib/server/mongodb/documents.ts';
import { safeMongoAggregateFingerprint } from './lib/sqlite-mongodb-migration.mjs';

const TIMEOUT_MS = 180_000;

function configuredPath(value, fallback) {
	const candidate = value?.trim() || fallback;
	return isAbsolute(candidate) ? resolve(candidate) : resolve(candidate);
}

async function fileSnapshot(path) {
	if (!existsSync(path)) return null;
	const bytes = await readFile(path);
	return {
		size: bytes.length,
		hash: createHash('sha256').update(bytes).digest('hex')
	};
}

async function directorySnapshot(root) {
	if (!existsSync(root)) return [];
	const result = [];
	async function visit(directory, prefix = '') {
		const entries = await readdir(directory, { withFileTypes: true });
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
			const absolute = join(directory, entry.name);
			if (entry.isDirectory()) await visit(absolute, relative);
			else if (entry.isFile()) {
				const info = await stat(absolute);
				const bytes = await readFile(absolute);
				result.push({
					path: relative,
					size: info.size,
					hash: createHash('sha256').update(bytes).digest('hex')
				});
			}
		}
	}
	await visit(root);
	return result;
}

function runRollbackSuite() {
	return new Promise((resolveRun, rejectRun) => {
		const child = spawn(
			process.execPath,
			[resolve('scripts/phase6-integration.mjs')],
			{
				cwd: resolve('.'),
				env: {
					...process.env,
					DATABASE_BACKEND: 'sqlite',
					PHASE6_FRESH_DATABASE: '1'
				},
				stdio: 'inherit',
				windowsHide: true
			}
		);
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			rejectRun(new Error('SQLite rollback integration exceeded its bounded timeout.'));
		}, TIMEOUT_MS);
		child.once('error', rejectRun);
		child.once('close', (code, signal) => {
			clearTimeout(timer);
			if (code === 0) resolveRun();
			else rejectRun(new Error(`SQLite rollback integration failed (exit ${code}, signal ${signal ?? 'none'}).`));
		});
	});
}

const sqlitePath = configuredPath(process.env.DATABASE_URL, 'data/app.db');
const audioRoot = configuredPath(process.env.AUDIO_STORAGE_PATH, 'storage/audio');
const envPath = resolve('.env');
const before = {
	sqlite: await fileSnapshot(sqlitePath),
	sqliteWal: await fileSnapshot(`${sqlitePath}-wal`),
	sqliteShm: await fileSnapshot(`${sqlitePath}-shm`),
	audio: await directorySnapshot(audioRoot),
	env: await fileSnapshot(envPath)
};

const config = readMongoConfig(process.env);
const manager = new MongoClientManager(config);
let primaryFailure;
try {
	const client = await manager.connect();
	const collections = getMongoCollections(client.db(config.databaseName));
	const mongoBefore = {
		fingerprint: await safeMongoAggregateFingerprint(collections),
		counter: await collections.counters.findOne(
			{ _id: TRACK_PUBLIC_ID_COUNTER },
			{ projection: { _id: 0, value: 1 }, timeoutMS: 5_000 }
		)
	};
	await manager.close(true);

	await runRollbackSuite();

	const verificationManager = new MongoClientManager(config);
	try {
		const verificationClient = await verificationManager.connect();
		const verificationCollections = getMongoCollections(
			verificationClient.db(config.databaseName)
		);
		assert.equal(
			await safeMongoAggregateFingerprint(verificationCollections),
			mongoBefore.fingerprint
		);
		assert.deepEqual(
			await verificationCollections.counters.findOne(
				{ _id: TRACK_PUBLIC_ID_COUNTER },
				{ projection: { _id: 0, value: 1 }, timeoutMS: 5_000 }
			),
			mongoBefore.counter
		);
	} finally {
		await verificationManager.close(true);
	}

	const after = {
		sqlite: await fileSnapshot(sqlitePath),
		sqliteWal: await fileSnapshot(`${sqlitePath}-wal`),
		sqliteShm: await fileSnapshot(`${sqlitePath}-shm`),
		audio: await directorySnapshot(audioRoot),
		env: await fileSnapshot(envPath)
	};
	assert.deepEqual(after, before);
	console.log('PASS: SQLite rollback suite used a fresh isolated database.');
	console.log('PASS: real MongoDB, SQLite, audio, and .env state remained unchanged.');
	console.log('PASS: SQLite handles, process, port, and temporary artifacts were cleaned.');
} catch (error) {
	primaryFailure = error;
} finally {
	await manager.close(true).catch(() => undefined);
}

if (primaryFailure) throw primaryFailure;

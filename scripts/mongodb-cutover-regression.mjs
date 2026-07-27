import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { MongoClientManager } from '../src/lib/server/mongodb/client.ts';
import {
	MONGODB_TEST_DATABASE_PREFIX,
	readMongoConfig
} from '../src/lib/server/mongodb/config.ts';
import { getMongoCollections } from '../src/lib/server/mongodb/collections.ts';
import { TRACK_PUBLIC_ID_COUNTER } from '../src/lib/server/mongodb/documents.ts';
import { safeMongoAggregateFingerprint } from './lib/mongodb-fingerprint.mjs';

const COMMAND_TIMEOUT_MS = 240_000;
const suites = [
	['MongoDB users contract', ['--experimental-strip-types', 'scripts/mongodb-users-integration.mjs']],
	['MongoDB auth and failure paths', ['--experimental-strip-types', 'scripts/mongodb-auth-integration.mjs']],
	['MongoDB tracks and storage failures', ['--experimental-strip-types', 'scripts/mongodb-tracks-integration.mjs']],
	['MongoDB query behavior', ['--experimental-strip-types', 'scripts/mongodb-queries-integration.mjs']],
	['full application cutover', ['--experimental-strip-types', 'scripts/mongodb-cutover-integration.mjs']],
	[
		'privacy, configuration, filesystem and quarantine failures',
		[
			'node_modules/vitest/vitest.mjs',
			'run',
			'src/lib/server/config-values.test.ts',
			'src/lib/server/mongodb/config.test.ts',
			'src/lib/server/mongodb/client.test.ts',
			'src/lib/server/mongodb/indexes.test.ts',
			'src/lib/server/tracks/persistence.test.ts',
			'src/lib/server/tracks/service.test.ts',
			'src/lib/server/tracks/management.test.ts',
			'src/lib/server/tracks/files.test.ts',
			'src/lib/server/tracks/public-model.test.ts',
			'src/lib/server/tracks/owner-model.test.ts'
		]
	]
];

async function fileSnapshot(path) {
	if (!existsSync(path)) return null;
	const bytes = await readFile(path);
	return { size: bytes.length, hash: createHash('sha256').update(bytes).digest('hex') };
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

function runSuite(label, args) {
	return new Promise((resolveRun, rejectRun) => {
		console.log(`\n[MongoDB] ${label}`);
		const child = spawn(process.execPath, args, {
			cwd: resolve('.'),
			env: { ...process.env, CI: '1', NO_COLOR: '1' },
			stdio: 'inherit',
			windowsHide: true
		});
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			rejectRun(new Error(`${label} exceeded its bounded timeout.`));
		}, COMMAND_TIMEOUT_MS);
		child.once('error', rejectRun);
		child.once('close', (code, signal) => {
			clearTimeout(timer);
			if (code === 0) resolveRun();
			else rejectRun(new Error(`${label} failed (exit ${code}, signal ${signal ?? 'none'}).`));
		});
	});
}

const config = readMongoConfig(process.env);
const manager = new MongoClientManager(config);
const audioRoot = resolve(process.env.AUDIO_STORAGE_PATH?.trim() || 'storage/audio');
let initialTestDatabases;
let realMongoBefore;
let localBefore;
let primaryFailure;

try {
	const client = await manager.connect();
	const admin = client.db('admin').admin();
	const listed = await admin.listDatabases({ nameOnly: true });
	initialTestDatabases = listed.databases
		.map(({ name }) => name)
		.filter((name) => name.startsWith(MONGODB_TEST_DATABASE_PREFIX))
		.sort();
	const collections = getMongoCollections(client.db(config.databaseName));
	realMongoBefore = {
		fingerprint: await safeMongoAggregateFingerprint(collections),
		counter: await collections.counters.findOne(
			{ _id: TRACK_PUBLIC_ID_COUNTER },
			{ projection: { _id: 0, value: 1 }, timeoutMS: 5_000 }
		)
	};
	localBefore = {
		audio: await directorySnapshot(audioRoot),
		env: await fileSnapshot(resolve('.env'))
	};
	await manager.close(true);

	for (const [label, args] of suites) await runSuite(label, args);

	const verificationManager = new MongoClientManager(config);
	try {
		const verificationClient = await verificationManager.connect();
		const verificationAdmin = verificationClient.db('admin').admin();
		const listedAfter = await verificationAdmin.listDatabases({ nameOnly: true });
		const testDatabasesAfter = listedAfter.databases
			.map(({ name }) => name)
			.filter((name) => name.startsWith(MONGODB_TEST_DATABASE_PREFIX))
			.sort();
		assert.deepEqual(testDatabasesAfter, initialTestDatabases);
		const collections = getMongoCollections(
			verificationClient.db(config.databaseName)
		);
		assert.equal(
			await safeMongoAggregateFingerprint(collections),
			realMongoBefore.fingerprint
		);
		assert.deepEqual(
			await collections.counters.findOne(
				{ _id: TRACK_PUBLIC_ID_COUNTER },
				{ projection: { _id: 0, value: 1 }, timeoutMS: 5_000 }
			),
			realMongoBefore.counter
		);
	} finally {
		await verificationManager.close(true);
	}

	const localAfter = {
		audio: await directorySnapshot(audioRoot),
		env: await fileSnapshot(resolve('.env'))
	};
	assert.deepEqual(localAfter, localBefore);
	console.log('\nMONGODB_CUTOVER_REGRESSION_PASSED=1');
	console.log('PASS: development MongoDB fingerprint and counter are unchanged.');
	console.log('PASS: pre-existing test databases were preserved and no owned test database leaked.');
	console.log('PASS: audio and .env state are unchanged.');
} catch (error) {
	primaryFailure = error;
} finally {
	await manager.close(true).catch(() => undefined);
}

if (primaryFailure) throw primaryFailure;

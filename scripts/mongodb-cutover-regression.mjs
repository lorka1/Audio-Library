import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { MongoClientManager } from '../src/lib/server/mongodb/client.ts';
import {
	MONGODB_TEST_DATABASE_PREFIX,
	readMongoConfig
} from '../src/lib/server/mongodb/config.ts';
import { getMongoCollections } from '../src/lib/server/mongodb/collections.ts';
import { TRACK_PUBLIC_ID_COUNTER } from '../src/lib/server/mongodb/documents.ts';
import { safeMongoAggregateFingerprint } from './lib/mongodb-fingerprint.mjs';
import { createSyntheticApplicationEnvironment } from './lib/synthetic-app-environment.mjs';

const COMMAND_TIMEOUT_MS = 240_000;
const require = createRequire(import.meta.url);
const vitestExecutable = resolve(
	dirname(require.resolve('vitest/package.json')),
	'vitest.mjs'
);
const suites = [
	['MongoDB users contract', ['--experimental-strip-types', 'scripts/mongodb-users-integration.mjs']],
	['MongoDB auth and failure paths', ['--experimental-strip-types', 'scripts/mongodb-auth-integration.mjs']],
	['MongoDB tracks and storage failures', ['--experimental-strip-types', 'scripts/mongodb-tracks-integration.mjs']],
	['MongoDB query behavior', ['--experimental-strip-types', 'scripts/mongodb-queries-integration.mjs']],
	['MongoDB private playlists', ['--experimental-strip-types', 'scripts/mongodb-playlists-integration.mjs']],
	['full application cutover', ['--experimental-strip-types', 'scripts/mongodb-cutover-integration.mjs']],
	[
		'privacy, configuration, filesystem and quarantine failures',
		[
			vitestExecutable,
			'run',
			'src/lib/server/config-values.test.ts',
			'src/lib/server/mongodb/config.test.ts',
			'src/lib/server/mongodb/client.test.ts',
			'src/lib/server/mongodb/indexes.test.ts',
			'src/lib/server/mongodb/verification.test.ts',
			'src/lib/server/operational/config.test.ts',
			'src/lib/server/operational/cleanup.test.ts',
			'src/lib/server/operational/logging.test.ts',
			'src/lib/server/operational/readiness.test.ts',
			'src/lib/server/operational/signals.test.ts',
			'src/lib/server/operational/shutdown.test.ts',
			'src/routes/api/health/live/server.test.ts',
			'scripts/lib/backup-safety.test.mjs',
			'scripts/lib/mongodb-database-tools.test.mjs',
			'scripts/lib/synthetic-app-environment.test.mjs',
			'src/lib/server/tracks/persistence.test.ts',
			'src/lib/server/tracks/service.test.ts',
			'src/lib/server/tracks/management.test.ts',
			'src/lib/server/tracks/files.test.ts',
			'src/lib/server/tracks/cover-files.test.ts',
			'src/lib/server/tracks/public-model.test.ts',
			'src/lib/server/tracks/owner-model.test.ts',
			'src/lib/server/tracks/mongodb-repository-delete.test.ts',
			'src/lib/server/playlists/validation.test.ts',
			'src/lib/server/playlists/picker.test.ts',
			'src/lib/server/playlists/mongodb-repository.test.ts',
			'src/lib/server/playlists/actions.test.ts',
			'src/routes/playlists/server.test.ts',
			'src/routes/playlists/[publicId]/server.test.ts'
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
			env: createSyntheticApplicationEnvironment({
				AUDIO_STORAGE_PATH: audioRoot,
				CI: '1',
				MONGODB_URI: config.uri,
				MONGODB_DB_NAME: config.databaseName,
				MONGODB_TEST_DB_NAME: config.testDatabaseName,
				NO_COLOR: '1'
			}),
			shell: false,
			stdio: 'inherit',
			windowsHide: true
		});
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill('SIGKILL');
		}, COMMAND_TIMEOUT_MS);
		timer.unref();
		const forwardSignal = (signal) => {
			if (child.exitCode === null && child.signalCode === null) child.kill(signal);
		};
		const handleSigint = () => forwardSignal('SIGINT');
		const handleSigterm = () => forwardSignal('SIGTERM');
		process.once('SIGINT', handleSigint);
		process.once('SIGTERM', handleSigterm);
		const cleanup = () => {
			clearTimeout(timer);
			process.removeListener('SIGINT', handleSigint);
			process.removeListener('SIGTERM', handleSigterm);
		};
		child.once('error', (error) => {
			cleanup();
			rejectRun(error);
		});
		child.once('close', (code, signal) => {
			cleanup();
			if (code === 0) resolveRun();
			else if (timedOut) rejectRun(new Error(`${label} exceeded its bounded timeout.`));
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

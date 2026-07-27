import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { MongoClientManager } from '../src/lib/server/mongodb/client.ts';
import {
	assertMongoTestDatabaseName,
	MONGODB_TEST_DATABASE_PREFIX,
	readMongoConfig
} from '../src/lib/server/mongodb/config.ts';
import { getMongoCollections } from '../src/lib/server/mongodb/collections.ts';
import { TRACK_PUBLIC_ID_COUNTER } from '../src/lib/server/mongodb/documents.ts';
import { safeMongoAggregateFingerprint } from './lib/sqlite-mongodb-migration.mjs';

const TIMEOUT_MS = 20 * 60_000;

function ownedName(base, developmentName) {
	const suffix = `_m8_clean_${randomBytes(6).toString('hex')}`;
	const name = `${base.slice(0, 63 - suffix.length)}${suffix}`;
	assertMongoTestDatabaseName(name, developmentName);
	return name;
}

function runCleanClone(environment) {
	return new Promise((resolveRun, rejectRun) => {
		const child = spawn(process.execPath, [resolve('scripts/clean-clone-check.mjs')], {
			cwd: resolve('.'),
			env: environment,
			stdio: 'inherit',
			windowsHide: true
		});
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			rejectRun(new Error('MongoDB clean-clone verification exceeded its bounded timeout.'));
		}, TIMEOUT_MS);
		child.once('error', rejectRun);
		child.once('close', (code, signal) => {
			clearTimeout(timer);
			if (code === 0) resolveRun();
			else rejectRun(new Error(`MongoDB clean-clone verification failed (exit ${code}, signal ${signal ?? 'none'}).`));
		});
	});
}

const config = readMongoConfig(process.env);
const ownedDatabase = ownedName(config.testDatabaseName, config.databaseName);
const manager = new MongoClientManager(config);
let initialTestDatabases;
let realBefore;
let primaryFailure;
let cleanupFailure;

try {
	const client = await manager.connect();
	const listed = await client.db('admin').admin().listDatabases({ nameOnly: true });
	initialTestDatabases = listed.databases
		.map(({ name }) => name)
		.filter((name) => name.startsWith(MONGODB_TEST_DATABASE_PREFIX))
		.sort();
	assert.equal(initialTestDatabases.includes(ownedDatabase), false);
	const collections = getMongoCollections(client.db(config.databaseName));
	realBefore = {
		fingerprint: await safeMongoAggregateFingerprint(collections),
		counter: await collections.counters.findOne(
			{ _id: TRACK_PUBLIC_ID_COUNTER },
			{ projection: { _id: 0, value: 1 }, timeoutMS: 5_000 }
		)
	};
	await manager.close(true);

	await runCleanClone({
		...process.env,
		CLEAN_CLONE_MONGODB: '1',
		DATABASE_BACKEND: 'mongodb',
		MONGODB_DB_NAME: ownedDatabase,
		MONGODB_TEST_DB_NAME: config.testDatabaseName
	});
} catch (error) {
	primaryFailure = error;
} finally {
	try {
		const cleanupManager = new MongoClientManager(config);
		try {
			const client = await cleanupManager.connect();
			const listed = await client.db('admin').admin().listDatabases({ nameOnly: true });
			if (listed.databases.some(({ name }) => name === ownedDatabase)) {
				await client.db(ownedDatabase).dropDatabase({ timeoutMS: 10_000 });
			}
			const listedAfter = await client.db('admin').admin().listDatabases({ nameOnly: true });
			const testDatabasesAfter = listedAfter.databases
				.map(({ name }) => name)
				.filter((name) => name.startsWith(MONGODB_TEST_DATABASE_PREFIX))
				.sort();
			assert.deepEqual(testDatabasesAfter, initialTestDatabases);
			const collections = getMongoCollections(client.db(config.databaseName));
			assert.equal(
				await safeMongoAggregateFingerprint(collections),
				realBefore.fingerprint
			);
			assert.deepEqual(
				await collections.counters.findOne(
					{ _id: TRACK_PUBLIC_ID_COUNTER },
					{ projection: { _id: 0, value: 1 }, timeoutMS: 5_000 }
				),
				realBefore.counter
			);
		} finally {
			await cleanupManager.close(true);
		}
	} catch (error) {
		cleanupFailure = error;
	}
	await manager.close(true).catch(() => undefined);
}

if (primaryFailure && cleanupFailure) {
	throw new AggregateError(
		[primaryFailure, cleanupFailure],
		'MongoDB clean-clone verification and cleanup both failed.'
	);
}
if (primaryFailure) throw primaryFailure;
if (cleanupFailure) throw cleanupFailure;
console.log('MONGODB_CLEAN_CLONE_VERIFICATION_PASSED=1');
console.log('PASS: exact owned base database and all nested test databases were removed.');
console.log('PASS: development MongoDB fingerprint and counter remained unchanged.');

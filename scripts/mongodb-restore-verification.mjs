import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { MongoClientManager } from '../src/lib/server/mongodb/client.ts';
import {
	assertMongoTestDatabaseName,
	MONGODB_TEST_DATABASE_PREFIX,
	readMongoConfig
} from '../src/lib/server/mongodb/config.ts';
import { getMongoCollections } from '../src/lib/server/mongodb/collections.ts';
import { verifyMongoOperationalState } from '../src/lib/server/mongodb/verification.ts';
import { createMongoTrackRepository } from '../src/lib/server/tracks/mongodb-repository.ts';
import { safeMongoAggregateFingerprint } from './lib/mongodb-fingerprint.mjs';
import { directoryAggregate, requireSafeDestinationRoot } from './lib/backup-safety.mjs';

const config = readMongoConfig(process.env);
const databaseBackup = requireSafeDestinationRoot(
	process.env.MONGODB_RESTORE_SOURCE,
	'MONGODB_RESTORE_SOURCE'
);
const audioBackup = requireSafeDestinationRoot(
	process.env.AUDIO_RESTORE_SOURCE,
	'AUDIO_RESTORE_SOURCE'
);
const databaseManifest = JSON.parse(await readFile(resolve(databaseBackup, 'manifest.json'), 'utf8'));
const audioManifest = JSON.parse(await readFile(resolve(audioBackup, 'manifest.json'), 'utf8'));
assert.equal(databaseManifest.status, 'complete', 'MongoDB backup is incomplete.');
assert.equal(audioManifest.status, 'complete', 'Audio backup is incomplete.');

const suffix = `_restore_${randomBytes(6).toString('hex')}`;
const restoredDatabaseName = `${MONGODB_TEST_DATABASE_PREFIX}${suffix}`.slice(0, 63);
assertMongoTestDatabaseName(restoredDatabaseName, config.databaseName);
assert.notEqual(restoredDatabaseName, config.testDatabaseName);
const temporaryAudioRoot = await mkdtemp(join(tmpdir(), 'audio-library-restore-'));
const restoredAudio = resolve(temporaryAudioRoot, 'audio');
const manager = new MongoClientManager(config);
let existedBefore = false;
let primaryFailure;
const cleanupFailures = [];

function runRestore() {
	return new Promise((resolveRun, rejectRun) => {
		const source = resolve(databaseBackup, 'dump', config.databaseName);
		if (!existsSync(source)) {
			rejectRun(new Error('MongoDB backup source is incomplete.'));
			return;
		}
		const child = spawn(process.env.MONGORESTORE_BINARY?.trim() || 'mongorestore', [
			'--uri', config.uri,
			'--db', restoredDatabaseName,
			'--quiet',
			source
		], { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			rejectRun(new Error('MongoDB restore verification timed out.'));
		}, 10 * 60_000);
		timer.unref();
		child.once('error', (error) => {
			clearTimeout(timer);
			rejectRun(error);
		});
		child.once('close', (code) => {
			clearTimeout(timer);
			if (code === 0) resolveRun();
			else rejectRun(new Error('mongorestore exited unsuccessfully.'));
		});
	});
}

try {
	const client = await manager.connect();
	const before = await client.db('admin').admin().listDatabases({ nameOnly: true });
	existedBefore = before.databases.some(({ name }) => name === restoredDatabaseName);
	assert.equal(existedBefore, false);
	await runRestore();
	await cp(resolve(audioBackup, 'audio'), restoredAudio, {
		recursive: true,
		errorOnExist: true,
		force: false,
		preserveTimestamps: true
	});
	assert.deepEqual(await directoryAggregate(restoredAudio), audioManifest.aggregate);

	const sourceCollections = getMongoCollections(client.db(config.databaseName));
	const restoredDatabase = client.db(restoredDatabaseName);
	const restoredCollections = getMongoCollections(restoredDatabase);
	await verifyMongoOperationalState(client, restoredDatabase);
	assert.equal(
		await safeMongoAggregateFingerprint(restoredCollections),
		await safeMongoAggregateFingerprint(sourceCollections)
	);
	const repository = createMongoTrackRepository(
		restoredCollections.tracks,
		restoredCollections.counters,
		restoredCollections.users
	);
	const browse = await repository.listPublicTracks({ sort: 'newest' });
	assert.ok(browse.length > 0, 'Synthetic restored Browse result is empty.');
	const detail = await repository.findPublicTrackByPublicId(browse[0].id);
	const stream = await repository.findTrackForStreaming(browse[0].id);
	assert.ok(detail && stream, 'Synthetic restored detail/stream lookup failed.');
	const restoredFile = resolve(restoredAudio, stream.storedFilename);
	const restoredFileInfo = await lstat(restoredFile);
	assert.ok(restoredFileInfo.isFile() && !restoredFileInfo.isSymbolicLink());
	assert.equal(restoredFileInfo.size, stream.fileSizeBytes);
	console.log(JSON.stringify({
		status: 'verified',
		databaseRestore: true,
		audioRestore: true,
		applicationReadOnlyProbe: true
	}));
} catch (error) {
	primaryFailure = error;
} finally {
	try {
		const client = await manager.connect();
		const listed = await client.db('admin').admin().listDatabases({ nameOnly: true });
		if (listed.databases.some(({ name }) => name === restoredDatabaseName) && !existedBefore) {
			await client.db(restoredDatabaseName).dropDatabase({ timeoutMS: 10_000 });
		}
	} catch (error) {
		cleanupFailures.push(error);
	}
	await manager.close(true).catch((error) => cleanupFailures.push(error));
	try {
		if (dirname(temporaryAudioRoot) !== resolve(tmpdir()) ||
			!temporaryAudioRoot.split(/[\\/]/).at(-1)?.startsWith('audio-library-restore-')) {
			throw new Error('Refusing unsafe restore cleanup.');
		}
		await rm(temporaryAudioRoot, { recursive: true, force: true });
	} catch (error) {
		cleanupFailures.push(error);
	}
}

if (primaryFailure && cleanupFailures.length) {
	throw new AggregateError([primaryFailure, ...cleanupFailures], 'Restore verification and cleanup failed.');
}
if (primaryFailure) throw primaryFailure;
if (cleanupFailures.length) throw new AggregateError(cleanupFailures, 'Restore cleanup failed.');

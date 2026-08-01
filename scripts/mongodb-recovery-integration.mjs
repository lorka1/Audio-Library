import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MongoClientManager } from '../src/lib/server/mongodb/client.ts';
import {
	assertMongoTestDatabaseName,
	readMongoConfig
} from '../src/lib/server/mongodb/config.ts';
import { getMongoCollections } from '../src/lib/server/mongodb/collections.ts';
import { TRACK_PUBLIC_ID_COUNTER } from '../src/lib/server/mongodb/documents.ts';
import { ensureMongoIndexes } from '../src/lib/server/mongodb/indexes.ts';

const config = readMongoConfig(process.env);
const suffix = `_recovery_${randomBytes(6).toString('hex')}`;
const sourceDatabaseName = `${config.testDatabaseName.slice(0, 63 - suffix.length)}${suffix}`;
assertMongoTestDatabaseName(sourceDatabaseName, config.databaseName);
const temporaryRoot = await mkdtemp(join(tmpdir(), 'audio-library-recovery-'));
const audioSource = resolve(temporaryRoot, 'source-audio');
const mongoBackups = resolve(temporaryRoot, 'mongodb-backups');
const audioBackups = resolve(temporaryRoot, 'audio-backups');
const manager = new MongoClientManager(config);
let initialDatabases;
let primaryFailure;
const cleanupFailures = [];

function runScript(script, environment) {
	return new Promise((resolveRun, rejectRun) => {
		const child = spawn(process.execPath, ['--experimental-strip-types', resolve(script)], {
			env: environment,
			stdio: 'inherit',
			windowsHide: true
		});
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			rejectRun(new Error(`${script} exceeded its bounded timeout.`));
		}, 10 * 60_000);
		timer.unref();
		child.once('error', rejectRun);
		child.once('close', (code) => {
			clearTimeout(timer);
			if (code === 0) resolveRun();
			else rejectRun(new Error(`${script} failed.`));
		});
	});
}

try {
	const client = await manager.connect();
	initialDatabases = (await client.db('admin').admin().listDatabases({ nameOnly: true }))
		.databases.map(({ name }) => name).sort();
	assert.equal(initialDatabases.includes(sourceDatabaseName), false);
	const collections = getMongoCollections(client.db(sourceDatabaseName));
	await ensureMongoIndexes(collections, { maxTimeMS: 8_000 });
	await collections.counters.insertOne({ _id: TRACK_PUBLIC_ID_COUNTER, value: 1 });
	const now = new Date('2026-01-01T00:00:00.000Z');
	const userId = randomUUID();
	const storageKey = `${randomUUID()}.mp3`;
	const content = Buffer.from('synthetic recovery audio');
	await mkdir(audioSource, { recursive: true });
	await writeFile(resolve(audioSource, storageKey), content, { flag: 'wx', mode: 0o600 });
	await collections.users.insertOne({
		_id: userId,
		username: 'synthetic_restore_owner',
		email: 'synthetic-restore@example.invalid',
		passwordHash: 'synthetic-not-a-real-password-hash',
		createdAt: now,
		updatedAt: now
	});
	const trackId = randomUUID();
	await collections.tracks.insertOne({
		_id: trackId,
		publicId: 1,
		ownerId: userId,
		title: 'Synthetic restore track',
		artist: 'Synthetic artist',
		bpm: 120,
		musicalKey: null,
		genre: null,
		description: null,
		originalFilename: 'synthetic.mp3',
		storageKey,
		mimeType: 'audio/mpeg',
		fileSizeBytes: content.byteLength,
		durationMs: null,
		visibility: 'public',
		createdAt: now,
		updatedAt: now
	});
	const playlistId = randomUUID();
	await collections.playlists.insertOne({
		_id: playlistId,
		publicId: randomBytes(18).toString('base64url'),
		ownerId: userId,
		name: 'Synthetic restore playlist',
		description: 'Synthetic recovery-only fixture.',
		createdAt: now,
		updatedAt: now
	});
	await collections.playlistItems.insertOne({
		_id: randomUUID(),
		playlistId,
		trackId,
		addedAt: now
	});
	await manager.close(true);

	const environment = {
		...process.env,
		MONGODB_DB_NAME: sourceDatabaseName,
		AUDIO_STORAGE_PATH: audioSource,
		MONGODB_BACKUP_ROOT: mongoBackups,
		AUDIO_BACKUP_ROOT: audioBackups
	};
	await runScript('scripts/mongodb-backup.mjs', environment);
	await runScript('scripts/audio-backup.mjs', environment);
	const mongoEntries = await readdir(mongoBackups);
	const audioEntries = await readdir(audioBackups);
	assert.equal(mongoEntries.length, 1);
	assert.equal(audioEntries.length, 1);
	await runScript('scripts/mongodb-restore-verification.mjs', {
		...environment,
		MONGODB_RESTORE_SOURCE: resolve(mongoBackups, mongoEntries[0]),
		AUDIO_RESTORE_SOURCE: resolve(audioBackups, audioEntries[0])
	});
	console.log('MONGODB_RECOVERY_INTEGRATION_PASSED=1');
} catch (error) {
	primaryFailure = error;
} finally {
	try {
		const cleanupManager = new MongoClientManager(config);
		try {
			const client = await cleanupManager.connect();
			const listed = await client.db('admin').admin().listDatabases({ nameOnly: true });
			if (listed.databases.some(({ name }) => name === sourceDatabaseName)) {
				await client.db(sourceDatabaseName).dropDatabase({ timeoutMS: 10_000 });
			}
			const remaining = (await client.db('admin').admin().listDatabases({ nameOnly: true }))
				.databases.map(({ name }) => name).sort();
			assert.deepEqual(remaining, initialDatabases);
		} finally {
			await cleanupManager.close(true);
		}
	} catch (error) {
		cleanupFailures.push(error);
	}
	await manager.close(true).catch((error) => cleanupFailures.push(error));
	try {
		if (!existsSync(temporaryRoot) ||
			resolve(temporaryRoot).split(/[\\/]/).at(-1)?.startsWith('audio-library-recovery-') !== true) {
			throw new Error('Refusing unsafe recovery-test cleanup.');
		}
		await rm(temporaryRoot, { recursive: true, force: true });
	} catch (error) {
		cleanupFailures.push(error);
	}
}

if (primaryFailure && cleanupFailures.length) {
	throw new AggregateError([primaryFailure, ...cleanupFailures], 'Recovery integration and cleanup failed.');
}
if (primaryFailure) throw primaryFailure;
if (cleanupFailures.length) throw new AggregateError(cleanupFailures, 'Recovery cleanup failed.');

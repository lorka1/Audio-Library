import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { MongoClientManager } from '../src/lib/server/mongodb/client.ts';
import {
	assertMongoTestDatabaseName,
	readMongoConfig
} from '../src/lib/server/mongodb/config.ts';
import { getMongoCollections } from '../src/lib/server/mongodb/collections.ts';
import { MONGODB_INDEX_DEFINITIONS } from '../src/lib/server/mongodb/indexes.ts';
import {
	applyMigration,
	analyzeMigrationSnapshot,
	dryRunMigration,
	MIGRATION_CONFIRMATION,
	readSqliteMigrationSnapshot,
	verifyMigration
} from './lib/sqlite-mongodb-migration.mjs';

const TIMEOUT_MS = 8_000;
const EXPECTED_CHECKS = 33;
let checkNumber = 0;
let activeStep = 'setup';

async function check(label, assertion) {
	await assertion();
	console.log(`[check ${++checkNumber}/${EXPECTED_CHECKS}] ${label}`);
}

function ownedName(base) {
	const suffix = `_m6_migration_${randomBytes(6).toString('hex')}`;
	const name = `${base.slice(0, 63 - suffix.length)}${suffix}`;
	assertMongoTestDatabaseName(name, process.env.MONGODB_DB_NAME ?? '');
	return name;
}

function safeError(error) {
	if (
		error instanceof Error &&
		(error.message.startsWith('MongoDB migration integration requires') ||
			error.message.startsWith('MongoDB migration apply requires'))
	) {
		return error.message;
	}
	return `MongoDB migration integration failed during ${activeStep}.`;
}

async function ensureIndexes(collections) {
	await Promise.all([
		collections.users.createIndexes([...MONGODB_INDEX_DEFINITIONS.users], {
			maxTimeMS: TIMEOUT_MS
		}),
		collections.tracks.createIndexes([...MONGODB_INDEX_DEFINITIONS.tracks], {
			maxTimeMS: TIMEOUT_MS
		})
	]);
}

function cloneSnapshot(snapshot) {
	return {
		users: snapshot.users.map((record) => ({ ...record })),
		tracks: snapshot.tracks.map((record) => ({ ...record })),
		sourceSessionCount: snapshot.sourceSessionCount
	};
}

async function createSyntheticSource(root) {
	const sqlitePath = join(root, 'synthetic.sqlite');
	const audioRoot = join(root, 'audio');
	await mkdir(audioRoot);
	const sqlite = createClient({ url: pathToFileURL(sqlitePath).href });
	const ownerA = randomUUID();
	const ownerB = randomUUID();
	const storageA = `${randomUUID()}.mp3`;
	const storageB = `${randomUUID()}.ogg`;
	const created = 1_782_800_000;
	try {
		await sqlite.batch(
			[
				`create table users (
					id text primary key, email text not null unique, username text not null unique,
					password_hash text not null, created_at integer not null, updated_at integer not null
				)`,
				`create table sessions (
					id text primary key, token_hash text not null, user_id text not null,
					expires_at integer not null, created_at integer not null
				)`,
				`create table tracks (
					public_id integer primary key, id text not null unique, owner_id text not null,
					title text not null, artist text not null, bpm integer, musical_key text,
					genre text, description text, original_filename text not null,
					storage_key text not null unique, mime_type text not null,
					file_size_bytes integer not null, duration_ms integer, visibility text not null,
					created_at integer not null, updated_at integer not null
				)`
			],
			'write'
		);
		await sqlite.batch(
			[
				{
					sql: 'insert into users values (?, ?, ?, ?, ?, ?)',
					args: [ownerA, 'first@example.test', 'migration_first', '$2b$12$synthetic-a', created, created + 1]
				},
				{
					sql: 'insert into users values (?, ?, ?, ?, ?, ?)',
					args: [ownerB, 'second@example.test', 'migration_second', '$2b$12$synthetic-b', created + 2, created + 3]
				},
				{
					sql: 'insert into sessions values (?, ?, ?, ?, ?)',
					args: [randomUUID(), 'synthetic-token-hash', ownerA, created + 9_999, created]
				},
				{
					sql: `insert into tracks values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					args: [7, randomUUID(), ownerA, 'Synthetic public', 'Synthetic artist', 120, 'C minor', 'Techno', null, 'public.mp3', storageA, 'audio/mpeg', 4, null, 'public', created + 4, created + 5]
				},
				{
					sql: `insert into tracks values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					args: [42, randomUUID(), ownerB, 'Synthetic private', 'Synthetic artist', null, null, null, 'Synthetic description', 'private.ogg', storageB, 'audio/ogg', 5, 0, 'private', created + 6, created + 7]
				}
			],
			'write'
		);
	} finally {
		sqlite.close();
	}
	await writeFile(join(audioRoot, storageA), Buffer.from([1, 2, 3, 4]));
	await writeFile(join(audioRoot, storageB), Buffer.from([5, 6, 7, 8, 9]));
	return { sqlitePath, audioRoot };
}

async function main() {
	const config = readMongoConfig(process.env);
	const databaseName = ownedName(config.testDatabaseName);
	const manager = new MongoClientManager({ ...config, testDatabaseName: databaseName });
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'audio-library-m6-'));
	const { sqlitePath, audioRoot } = await createSyntheticSource(temporaryRoot);
	const initialAudioNames = (await readdir(audioRoot)).sort();
	const audioBefore = createHash('sha256')
		.update(await readFile(join(audioRoot, initialAudioNames[0])))
		.digest('hex');
	let opened;
	let database;
	let client;
	let primaryFailure;
	let cleanupFailure;
	let sqliteClosed = false;
	let activeClientSessions = 0;

	try {
		activeStep = 'transaction capability check';
		client = await manager.connect();
		const hello = await client.db('admin').command({ hello: 1 }, { timeoutMS: TIMEOUT_MS });
		const transactionSupported = typeof hello.setName === 'string' || hello.msg === 'isdbgrid';
		if (!transactionSupported) {
			throw new Error(
				'MongoDB migration integration requires Atlas or a replica-set deployment with transaction support.'
			);
		}
		await check('transaction support is available', () => assert.equal(transactionSupported, true));
		database = client.db(databaseName);
		const collections = getMongoCollections(database);
		await ensureIndexes(collections);
		opened = await readSqliteMigrationSnapshot({
			sourcePath: sqlitePath,
			audioStoragePath: audioRoot
		});

		const dryRun = await dryRunMigration({
			snapshot: opened.snapshot,
			analysis: opened.analysis,
			collections,
			client
		});
		await check('dry-run performs no writes', async () => {
			assert.equal(dryRun.canApply, true);
			assert.equal(dryRun.targetUnchanged, true);
			assert.equal(await collections.users.countDocuments({}), 0);
			assert.equal(await collections.tracks.countDocuments({}), 0);
		});

		for (const [label, mutate, expectedCategory] of [
			['duplicate source public ID aborts', (copy) => { copy.tracks[1].publicId = copy.tracks[0].publicId; }, 'duplicatePublicIds'],
			['duplicate source storage key aborts', (copy) => { copy.tracks[1].storageKey = copy.tracks[0].storageKey; }, 'duplicateStorageKeys'],
			['missing source owner aborts', (copy) => { copy.tracks[1].ownerId = randomUUID(); }, 'missingOwners']
		]) {
			await check(label, async () => {
				const copy = cloneSnapshot(opened.snapshot);
				mutate(copy);
				const analysis = analyzeMigrationSnapshot(copy, copy.tracks.map(() => true));
				assert.equal(analysis.categories.includes(expectedCategory), true);
				await assert.rejects(
					applyMigration({
						snapshot: copy,
						analysis,
						collections,
						client,
						confirmation: MIGRATION_CONFIRMATION
					})
				);
			});
		}

		await collections.users.insertOne(opened.snapshot.users[0]);
		await check('incompatible target user aborts', async () =>
			assert.rejects(applyMigration({
				snapshot: opened.snapshot, analysis: opened.analysis, collections, client,
				confirmation: MIGRATION_CONFIRMATION
			}))
		);
		await collections.users.deleteMany({});
		await collections.tracks.insertOne(opened.snapshot.tracks[0]);
		await check('incompatible target track aborts', async () =>
			assert.rejects(applyMigration({
				snapshot: opened.snapshot, analysis: opened.analysis, collections, client,
				confirmation: MIGRATION_CONFIRMATION
			}))
		);
		await collections.tracks.deleteMany({});
		await collections.counters.insertOne({ _id: 'tracks.publicId', value: 500 });
		await check('non-empty unsafe target aborts', async () =>
			assert.rejects(applyMigration({
				snapshot: opened.snapshot, analysis: opened.analysis, collections, client,
				confirmation: MIGRATION_CONFIRMATION
			}))
		);
		await collections.counters.deleteMany({});

		await assert.rejects(
			applyMigration({
				snapshot: opened.snapshot,
				analysis: opened.analysis,
				collections,
				client,
				confirmation: MIGRATION_CONFIRMATION,
				failureStep: 'after-counter'
			})
		);
		await check('rollback leaves no partial users', async () =>
			assert.equal(await collections.users.countDocuments({}), 0)
		);
		await check('rollback leaves no partial tracks', async () =>
			assert.equal(await collections.tracks.countDocuments({}), 0)
		);
		await check('rollback leaves no public-ID counter', async () =>
			assert.equal(await collections.counters.countDocuments({}), 0)
		);

		const applied = await applyMigration({
			snapshot: opened.snapshot,
			analysis: opened.analysis,
			collections,
			client,
			confirmation: MIGRATION_CONFIRMATION
		});
		const targetUsers = await collections.users.find({}).toArray();
		const targetTracks = await collections.tracks.find({}).toArray();
		await check('users migrate', () => assert.equal(targetUsers.length, 2));
		await check('password hashes remain byte-for-byte equivalent', () =>
			assert.deepEqual(
				targetUsers.map(({ passwordHash }) => passwordHash).sort(),
				opened.snapshot.users.map(({ passwordHash }) => passwordHash).sort()
			)
		);
		await check('tracks migrate', () => assert.equal(targetTracks.length, 2));
		await check('user and track UUIDs are preserved', () => {
			assert.deepEqual(targetUsers.map(({ _id }) => _id).sort(), opened.snapshot.users.map(({ _id }) => _id).sort());
			assert.deepEqual(targetTracks.map(({ _id }) => _id).sort(), opened.snapshot.tracks.map(({ _id }) => _id).sort());
		});
		await check('public IDs are preserved', () =>
			assert.deepEqual(
				targetTracks.map(({ publicId }) => publicId).sort((left, right) => left - right),
				[7, 42]
			)
		);
		await check('ownership is preserved', () =>
			assert.deepEqual(targetTracks.map(({ ownerId }) => ownerId).sort(), opened.snapshot.tracks.map(({ ownerId }) => ownerId).sort())
		);
		await check('public and private visibility are preserved', () =>
			assert.deepEqual(targetTracks.map(({ visibility }) => visibility).sort(), ['private', 'public'])
		);
		await check('nullable metadata is preserved', () => {
			const nullable = targetTracks.find(({ publicId }) => publicId === 42);
			assert.equal(nullable.bpm, null);
			assert.equal(nullable.musicalKey, null);
			assert.equal(nullable.genre, null);
		});
		await check('timestamps are preserved', () =>
			assert.deepEqual(
				targetTracks.map(({ createdAt, updatedAt }) => [createdAt.toISOString(), updatedAt.toISOString()]),
				opened.snapshot.tracks.map(({ createdAt, updatedAt }) => [createdAt.toISOString(), updatedAt.toISOString()])
			)
		);
		await check('sessions are intentionally not migrated', async () =>
			assert.equal(await collections.sessions.countDocuments({}), 0)
		);
		await check('audio bytes are not copied or modified', async () => {
			const names = (await readdir(audioRoot)).sort();
			const current = createHash('sha256').update(await readFile(join(audioRoot, names[0]))).digest('hex');
			assert.equal(current, audioBefore);
		});
		await check('storage references are preserved', () =>
			assert.deepEqual(targetTracks.map(({ storageKey }) => storageKey).sort(), opened.snapshot.tracks.map(({ storageKey }) => storageKey).sort())
		);
		const counter = await collections.counters.findOne({ _id: 'tracks.publicId' });
		await check('public-ID counter initializes at migrated maximum', () =>
			assert.equal(counter.value, 42)
		);
		await check('next allocator value cannot collide without consuming it', () =>
			assert.equal(counter.value + 1 > Math.max(...targetTracks.map(({ publicId }) => publicId)), true)
		);
		await check('verification succeeds after migration', () =>
			assert.equal(applied.verification.ok, true)
		);
		await collections.tracks.updateOne({ publicId: 7 }, { $set: { bpm: 121 } });
		await check('verification detects modified target data', async () =>
			assert.equal((await verifyMigration({
				snapshot: opened.snapshot, analysis: opened.analysis, collections
			})).ok, false)
		);
		await collections.tracks.updateOne({ publicId: 7 }, { $set: { bpm: 120 } });
		await check('successful rerun is safe and deterministic', async () => {
			const rerun = await applyMigration({
				snapshot: opened.snapshot, analysis: opened.analysis, collections, client,
				confirmation: MIGRATION_CONFIRMATION
			});
			assert.equal(rerun.rerun, true);
			assert.equal(rerun.verification.ok, true);
		});
		const session = client.startSession();
		activeClientSessions += 1;
		await session.endSession();
		activeClientSessions -= 1;
	} catch (error) {
		primaryFailure = error;
	} finally {
		if (opened) {
			opened.close();
			sqliteClosed = true;
		}
		if (database) {
			try {
				activeStep = 'exact migration database cleanup';
				await database.dropDatabase({ timeoutMS: TIMEOUT_MS });
				await check('exact test database cleanup', () => undefined);
			} catch (error) {
				cleanupFailure = error;
			}
		}
		try {
			activeStep = 'temporary source cleanup';
			await unlink(sqlitePath);
			await check('exact temporary SQLite cleanup', () => undefined);
			await rm(audioRoot, { recursive: true });
			await check('exact temporary audio cleanup', () => undefined);
			await rm(temporaryRoot, { recursive: true });
		} catch (error) {
			cleanupFailure ??= error;
		}
		try {
			activeStep = 'connection cleanup';
			await manager.close(true);
			if (!primaryFailure) {
				await check('MongoClient and ClientSession cleanup', () =>
					assert.equal(activeClientSessions, 0)
				);
				await check('SQLite connection cleanup', () =>
					assert.equal(sqliteClosed, true)
				);
			}
		} catch (error) {
			cleanupFailure ??= error;
		}
	}
	if (primaryFailure) throw primaryFailure;
	if (cleanupFailure) throw cleanupFailure;
	assert.equal(checkNumber, EXPECTED_CHECKS);
	console.log(`MongoDB migration integration passed ${checkNumber}/${EXPECTED_CHECKS}.`);
}

main().catch((error) => {
	console.error(safeError(error));
	process.exitCode = 1;
});

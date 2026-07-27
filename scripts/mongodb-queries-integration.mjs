import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';
import { MongoClientManager } from '../src/lib/server/mongodb/client.ts';
import {
	assertMongoTestDatabaseName,
	readMongoConfig
} from '../src/lib/server/mongodb/config.ts';
import { getMongoCollections } from '../src/lib/server/mongodb/collections.ts';
import { MONGODB_INDEX_DEFINITIONS } from '../src/lib/server/mongodb/indexes.ts';
import { createMongoTrackRepository } from '../src/lib/server/tracks/mongodb-repository.ts';
import {
	DEFAULT_TRACK_SORT,
	TRACK_SORTS
} from '../src/lib/tracks-query.ts';
import {
	assertUnifiedDatabaseBackend,
	assertUnifiedAuthBackend,
	parseDatabaseBackend
} from '../src/lib/server/users/backend.ts';

const OPERATION_TIMEOUT_MS = 5_000;
const TOTAL_TIMEOUT_MS = 120_000;
const EXPECTED_CHECKS = 36;
let checkNumber = 0;
let activeStep = 'setup';

async function check(label, assertion) {
	await assertion();
	console.log(`[check ${++checkNumber}/${EXPECTED_CHECKS}] ${label}`);
}

function ownedDatabaseName(base) {
	const suffix = `_m5_queries_${randomBytes(6).toString('hex')}`;
	const name = `${base.slice(0, 63 - suffix.length)}${suffix}`;
	assertMongoTestDatabaseName(name, process.env.MONGODB_DB_NAME ?? '');
	return name;
}

function safeError(error) {
	if (
		error instanceof Error &&
		error.message.startsWith('MongoDB query integration requires')
	) {
		return error.message;
	}
	return `MongoDB query integration failed during ${activeStep}.`;
}

function escapeSqlLike(value) {
	return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function sqliteOrder(sort) {
	switch (sort) {
		case 'oldest':
			return 'created_at asc, public_id asc';
		case 'title_asc':
			return 'lower(title) asc, public_id asc';
		case 'title_desc':
			return 'lower(title) desc, public_id asc';
		case 'bpm_asc':
			return 'case when bpm is null then 1 else 0 end asc, bpm asc, public_id asc';
		case 'bpm_desc':
			return 'case when bpm is null then 1 else 0 end asc, bpm desc, public_id asc';
		case 'newest':
			return 'created_at desc, public_id desc';
	}
}

async function sqlitePublicTracks(client, query) {
	const conditions = ['tracks.visibility = ?'];
	const args = ['public'];
	if (query.q) {
		const pattern = `%${escapeSqlLike(query.q)}%`;
		conditions.push(`(
			lower(tracks.title) like lower(?) escape '\\' or
			lower(tracks.artist) like lower(?) escape '\\' or
			lower(tracks.description) like lower(?) escape '\\'
		)`);
		args.push(pattern, pattern, pattern);
	}
	if (query.bpmMin !== undefined) {
		conditions.push('tracks.bpm >= ?');
		args.push(query.bpmMin);
	}
	if (query.bpmMax !== undefined) {
		conditions.push('tracks.bpm <= ?');
		args.push(query.bpmMax);
	}
	if (query.musicalKey) {
		conditions.push('tracks.musical_key = ?');
		args.push(query.musicalKey);
	}
	if (query.genre) {
		conditions.push('tracks.genre = ?');
		args.push(query.genre);
	}
	const result = await client.execute({
		sql: `select
			tracks.public_id, tracks.title, tracks.artist, tracks.bpm,
			tracks.musical_key, tracks.genre, tracks.description,
			tracks.file_size_bytes, users.username as owner_username,
			tracks.created_at, tracks.updated_at
			from tracks
			inner join users on tracks.owner_id = users.id
			where ${conditions.join(' and ')}
			order by ${sqliteOrder(query.sort)}`,
		args
	});
	return result.rows.map((row) => ({
		id: Number(row.public_id),
		title: String(row.title),
		artist: String(row.artist),
		bpm: row.bpm === null ? null : Number(row.bpm),
		musicalKey: row.musical_key === null ? null : String(row.musical_key),
		genre: row.genre === null ? null : String(row.genre),
		description: row.description === null ? null : String(row.description),
		fileSizeBytes: Number(row.file_size_bytes),
		ownerUsername: String(row.owner_username),
		createdAt: new Date(Number(row.created_at) * 1_000).toISOString(),
		updatedAt: new Date(Number(row.updated_at) * 1_000).toISOString()
	}));
}

function normalized(records) {
	return records.map((record) => ({
		...record,
		createdAt: new Date(record.createdAt).toISOString(),
		updatedAt: new Date(record.updatedAt).toISOString()
	}));
}

async function developmentDigest(database) {
	const names = (
		await database
			.listCollections({}, { nameOnly: true, timeoutMS: OPERATION_TIMEOUT_MS })
			.toArray()
	)
		.map(({ name }) => name)
		.sort();
	const summaries = [];
	for (const name of names) {
		const [summary] = await database
			.collection(name)
			.aggregate(
				[
					{
						$group: {
							_id: null,
							count: { $sum: 1 },
							totalBytes: { $sum: { $bsonSize: '$$ROOT' } }
						}
					},
					{ $project: { _id: 0, count: 1, totalBytes: 1 } }
				],
				{ maxTimeMS: OPERATION_TIMEOUT_MS }
			)
			.toArray();
		summaries.push({
			name,
			count: summary?.count ?? 0,
			totalBytes: summary?.totalBytes ?? 0
		});
	}
	return createHash('sha256').update(JSON.stringify(summaries)).digest('hex');
}

async function createSqliteSchema(client) {
	await client.batch(
		[
			`create table users (
				id text primary key not null,
				username text not null
			)`,
			`create table tracks (
				public_id integer primary key not null,
				id text not null unique,
				owner_id text not null,
				title text not null,
				artist text not null,
				bpm integer,
				musical_key text,
				genre text,
				description text,
				original_filename text not null,
				storage_key text not null unique,
				mime_type text not null,
				file_size_bytes integer not null,
				duration_ms integer,
				visibility text not null,
				created_at integer not null,
				updated_at integer not null
			)`
		],
		'write'
	);
}

function seedDefinitions(ownerId) {
	const second = 1_782_732_000;
	const fields = (publicId, overrides = {}) => ({
		publicId,
		_id: randomUUID(),
		ownerId,
		title: `Synthetic ${publicId}`,
		artist: 'Fixture Artist',
		bpm: 120,
		musicalKey: 'A minor',
		genre: 'House',
		description: null,
		originalFilename: `fixture-${publicId}.mp3`,
		storageKey: `${randomUUID()}.mp3`,
		mimeType: 'audio/mpeg',
		fileSizeBytes: 100 + publicId,
		durationMs: null,
		visibility: 'public',
		createdAt: new Date((second + publicId) * 1_000),
		updatedAt: new Date((second + publicId) * 1_000),
		...overrides
	});
	return [
		fields(1, {
			title: 'Zulu Beat',
			artist: 'Alpha Artist',
			bpm: 140,
			description: 'Sunset festival recording.',
			createdAt: new Date((second + 1) * 1_000),
			updatedAt: new Date((second + 1) * 1_000)
		}),
		fields(2, {
			title: 'alpha pulse',
			artist: 'BETA CREW',
			bpm: 90,
			musicalKey: 'C major',
			genre: 'Jazz',
			createdAt: new Date((second + 2) * 1_000),
			updatedAt: new Date((second + 2) * 1_000)
		}),
		fields(3, {
			title: 'Croatian Night',
			artist: 'Zed',
			bpm: 120,
			description: 'Late night combined needle.',
			createdAt: new Date((second + 3) * 1_000),
			updatedAt: new Date((second + 3) * 1_000)
		}),
		fields(4, {
			title: 'Percent 100%_mix',
			artist: String.raw`Back\slash Artist`,
			bpm: null,
			musicalKey: 'D minor',
			genre: 'Electronic',
			description: 'Literal regex .*+?^$()[]{}| characters.',
			createdAt: new Date((second + 4) * 1_000),
			updatedAt: new Date((second + 4) * 1_000)
		}),
		fields(5, {
			title: 'Bravo',
			artist: 'Gamma',
			bpm: 120,
			description: 'Combined needle track.',
			createdAt: new Date((second + 3) * 1_000),
			updatedAt: new Date((second + 3) * 1_000)
		}),
		fields(6, {
			title: 'Private alpha needle',
			artist: 'Alpha Artist',
			bpm: 110,
			description: 'Private sunset.',
			visibility: 'private',
			createdAt: new Date((second + 20) * 1_000),
			updatedAt: new Date((second + 20) * 1_000)
		}),
		fields(7, {
			title: 'No BPM',
			artist: 'Null Artist',
			bpm: null,
			musicalKey: null,
			genre: null,
			createdAt: new Date((second + 5) * 1_000),
			updatedAt: new Date((second + 5) * 1_000)
		})
	];
}

async function seedBoth(sqlite, collections, ownerId, definitions) {
	await sqlite.execute({
		sql: 'insert into users (id, username) values (?, ?)',
		args: [ownerId, 'query_owner']
	});
	await collections.users.insertOne(
		{
			_id: ownerId,
			username: 'query_owner',
			email: 'query.owner@example.test',
			passwordHash: 'synthetic-hash',
			createdAt: new Date('2026-07-27T10:00:00.000Z'),
			updatedAt: new Date('2026-07-27T10:00:00.000Z')
		},
		{ timeoutMS: OPERATION_TIMEOUT_MS }
	);
	for (const document of definitions) {
		await sqlite.execute({
			sql: `insert into tracks (
				public_id, id, owner_id, title, artist, bpm, musical_key, genre,
				description, original_filename, storage_key, mime_type,
				file_size_bytes, duration_ms, visibility, created_at, updated_at
			) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				document.publicId,
				document._id,
				document.ownerId,
				document.title,
				document.artist,
				document.bpm,
				document.musicalKey,
				document.genre,
				document.description,
				document.originalFilename,
				document.storageKey,
				document.mimeType,
				document.fileSizeBytes,
				document.durationMs,
				document.visibility,
				Math.floor(document.createdAt.getTime() / 1_000),
				Math.floor(document.updatedAt.getTime() / 1_000)
			]
		});
	}
	await collections.tracks.insertMany(definitions, {
		timeoutMS: OPERATION_TIMEOUT_MS
	});
}

async function main() {
	const config = readMongoConfig(process.env);
	const databaseName = ownedDatabaseName(config.testDatabaseName);
	assert.notEqual(databaseName, config.databaseName);
	const manager = new MongoClientManager({ ...config, testDatabaseName: databaseName });
	const sqlite = createClient({ url: ':memory:' });
	const watchdog = setTimeout(() => {
		throw new Error('MongoDB query integration timed out.');
	}, TOTAL_TIMEOUT_MS);
	watchdog.unref();
	let database;
	let primaryFailure;
	let cleanupFailure;
	let activeClientSessions = 0;

	try {
		activeStep = 'isolated query setup';
		const client = await manager.connect();
		database = client.db(databaseName);
		const development = client.db(config.databaseName);
		const beforeDigest = await developmentDigest(development);
		const collections = getMongoCollections(database);
		await Promise.all([
			collections.users.createIndexes(
				[...MONGODB_INDEX_DEFINITIONS.users],
				{ maxTimeMS: OPERATION_TIMEOUT_MS }
			),
			collections.tracks.createIndexes(
				[...MONGODB_INDEX_DEFINITIONS.tracks],
				{ maxTimeMS: OPERATION_TIMEOUT_MS }
			)
		]);
		await createSqliteSchema(sqlite);
		const ownerId = randomUUID();
		const definitions = seedDefinitions(ownerId);
		await seedBoth(sqlite, collections, ownerId, definitions);
		const mongodb = createMongoTrackRepository(
			collections.tracks,
			collections.counters,
			collections.users,
			{ timeoutMS: OPERATION_TIMEOUT_MS }
		);

		async function parity(label, query, assertion = () => undefined) {
			await check(label, async () => {
				const sqliteResult = normalized(await sqlitePublicTracks(sqlite, query));
				const mongoResult = normalized(await mongodb.listPublicTracks(query));
				assert.deepEqual(mongoResult, sqliteResult);
				await assertion(mongoResult);
			});
		}

		await parity('default public listing', { sort: DEFAULT_TRACK_SORT });
		await parity('private tracks excluded', { sort: 'newest' }, (records) =>
			assert.equal(records.some(({ title }) => title.startsWith('Private')), false)
		);
		await parity('title substring search', { q: 'pulse', sort: 'newest' });
		await parity('artist substring search', { q: 'beta crew', sort: 'newest' });
		await parity('description substring search', { q: 'sunset', sort: 'newest' });
		await parity('ASCII case behavior', { q: 'ALPHA PULSE', sort: 'newest' });
		await parity('literal percent search', { q: '%', sort: 'newest' });
		await parity('literal underscore search', { q: '_mix', sort: 'newest' });
		await parity('literal backslash search', { q: String.raw`Back\slash`, sort: 'newest' });
		await parity('literal regex metacharacter search', {
			q: '.*+?^$()[]{}|',
			sort: 'newest'
		});
		await parity('inclusive BPM minimum', { bpmMin: 120, sort: 'newest' });
		await parity('inclusive BPM maximum', { bpmMax: 120, sort: 'newest' });
		await parity('equal BPM boundaries', { bpmMin: 120, bpmMax: 120, sort: 'newest' });
		await parity('combined BPM range', { bpmMin: 100, bpmMax: 130, sort: 'newest' });
		await parity('missing BPM filter behavior', { bpmMin: 20, sort: 'newest' }, (records) =>
			assert.equal(records.every(({ bpm }) => bpm !== null), true)
		);
		await parity('musical-key equality', { musicalKey: 'A minor', sort: 'newest' });
		await parity('genre equality', { genre: 'House', sort: 'newest' });
		await parity('search plus BPM', { q: 'needle', bpmMin: 120, sort: 'newest' });
		await parity('search plus key and genre', {
			q: 'needle',
			musicalKey: 'A minor',
			genre: 'House',
			sort: 'newest'
		});
		await parity('all supported filters combined', {
			q: 'needle',
			bpmMin: 120,
			bpmMax: 120,
			musicalKey: 'A minor',
			genre: 'House',
			sort: 'oldest'
		});
		await parity('newest sorting', { sort: 'newest' });
		await parity('oldest sorting', { sort: 'oldest' });
		await parity('title ascending sorting', { sort: 'title_asc' });
		await parity('title descending sorting', { sort: 'title_desc' });
		await parity('BPM ascending with nulls last', { sort: 'bpm_asc' }, (records) =>
			assert.equal(records.at(-1)?.bpm, null)
		);
		await parity('BPM descending with nulls last', { sort: 'bpm_desc' }, (records) =>
			assert.equal(records.at(-1)?.bpm, null)
		);
		await parity('deterministic public-ID tie ordering', {
			bpmMin: 120,
			bpmMax: 120,
			sort: 'bpm_asc'
		});
		await parity('empty search behaves as absent', { q: '', sort: 'newest' });
		await parity('no-result query', { q: 'definitely absent', sort: 'newest' }, (records) =>
			assert.equal(records.length, 0)
		);
		await check('invalid query values retain safe centralized defaults', () => {
			assert.equal(parseDatabaseBackend(undefined), 'sqlite');
			assert.throws(() => parseDatabaseBackend('unsupported'));
			assert.equal(TRACK_SORTS.includes('title-desc'), false);
		});
		await parity('public-safe projection equality', { q: 'Zulu', sort: 'newest' }, (records) =>
			assert.deepEqual(Object.keys(records[0] ?? {}).sort(), [
				'artist', 'bpm', 'createdAt', 'description', 'fileSizeBytes', 'genre',
				'id', 'musicalKey', 'ownerUsername', 'title', 'updatedAt'
			])
		);
		await check('complete SQLite backend selection remains unified', () => {
			assert.equal(parseDatabaseBackend('sqlite'), 'sqlite');
			assert.equal(
				assertUnifiedDatabaseBackend('sqlite', 'sqlite', 'sqlite'),
				'sqlite'
			);
		});
		await check('complete MongoDB backend selection remains unified', () => {
			assert.equal(parseDatabaseBackend('mongodb'), 'mongodb');
			assert.equal(
				assertUnifiedDatabaseBackend('mongodb', 'mongodb', 'mongodb'),
				'mongodb'
			);
			assert.throws(() => assertUnifiedAuthBackend('mongodb', 'sqlite'));
			assert.throws(() =>
				assertUnifiedDatabaseBackend('mongodb', 'mongodb', 'sqlite')
			);
		});
		await check('development MongoDB safe aggregate hash remains unchanged', async () =>
			assert.equal(await developmentDigest(development), beforeDigest)
		);

		const session = client.startSession();
		activeClientSessions += 1;
		await session.endSession();
		activeClientSessions -= 1;
	} catch (error) {
		primaryFailure = error;
	} finally {
		try {
			sqlite.close();
		} catch (error) {
			cleanupFailure = error;
		}
		if (database) {
			try {
				activeStep = 'exact query database cleanup';
				await database.dropDatabase({ timeoutMS: OPERATION_TIMEOUT_MS });
				await check('exact query test database cleanup', () => undefined);
			} catch (error) {
				cleanupFailure ??= error;
			}
		}
		try {
			activeStep = 'query client cleanup';
			await manager.close(true);
			if (!primaryFailure) {
				await check('owned query MongoClient and ClientSession cleanup', () =>
					assert.equal(activeClientSessions, 0)
				);
			}
		} catch (error) {
			cleanupFailure ??= error;
		}
		clearTimeout(watchdog);
	}
	if (primaryFailure) throw primaryFailure;
	if (cleanupFailure) throw cleanupFailure;
	assert.equal(checkNumber, EXPECTED_CHECKS);
	console.log(`MongoDB query parity integration passed ${checkNumber}/${EXPECTED_CHECKS}.`);
}

main().catch((error) => {
	console.error(safeError(error));
	process.exitCode = 1;
});

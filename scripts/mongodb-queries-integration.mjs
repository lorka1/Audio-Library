import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
	TRACK_SORTS,
	escapeRegexSearchTerm
} from '../src/lib/tracks-query.ts';

const OPERATION_TIMEOUT_MS = 5_000;
const TOTAL_TIMEOUT_MS = 120_000;
const EXPECTED_CHECKS = 35;
let checkNumber = 0;
let activeStep = 'setup';

async function check(label, assertion) {
	await assertion();
	console.log(`[check ${++checkNumber}/${EXPECTED_CHECKS}] ${label}`);
}

function ownedDatabaseName(base, developmentName) {
	const suffix = `_queries_${randomBytes(6).toString('hex')}`;
	const name = `${base.slice(0, 63 - suffix.length)}${suffix}`;
	assertMongoTestDatabaseName(name, developmentName);
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
		coverImage: null,
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
			coverImage: {
				storageKey: `${randomUUID()}.png`,
				mimeType: 'image/png',
				byteSize: 68
			}
		}),
		fields(2, {
			title: 'alpha pulse',
			artist: 'BETA CREW',
			bpm: 90,
			musicalKey: 'C major',
			genre: 'Jazz'
		}),
		fields(3, {
			title: 'Croatian Night',
			artist: 'Zed',
			description: 'Late night combined needle.'
		}),
		fields(4, {
			title: 'Percent 100%_mix',
			artist: String.raw`Back\slash Artist`,
			bpm: null,
			musicalKey: 'D minor',
			genre: 'Electronic',
			description: 'Literal regex .*+?^$()[]{}| characters.'
		}),
		fields(5, {
			title: 'Bravo',
			artist: 'Gamma',
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
		(() => {
			const legacyTrack = fields(7, {
			title: 'No BPM',
			artist: 'Null Artist',
			bpm: null,
			musicalKey: null,
			genre: null
			});
			delete legacyTrack.coverImage;
			return legacyTrack;
		})()
	];
}

function expectedRecords(definitions, query) {
	const records = definitions.filter((record) => {
		if (record.visibility !== 'public') return false;
		if (query.q) {
			const needle = query.q.toLowerCase();
			if (
				![record.title, 'query_owner', record.description ?? ''].some((value) =>
					value.toLowerCase().includes(needle)
				)
			) return false;
		}
		if (query.bpmMin !== undefined && (record.bpm === null || record.bpm < query.bpmMin)) return false;
		if (query.bpmMax !== undefined && (record.bpm === null || record.bpm > query.bpmMax)) return false;
		if (query.musicalKey && record.musicalKey !== query.musicalKey) return false;
		if (query.genre && record.genre !== query.genre) return false;
		return true;
	});
	const direction = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
	records.sort((left, right) => {
		switch (query.sort) {
			case 'oldest':
				return left.createdAt - right.createdAt || left.publicId - right.publicId;
			case 'title_asc':
				return direction(left.title.toLowerCase(), right.title.toLowerCase()) || left.publicId - right.publicId;
			case 'title_desc':
				return direction(right.title.toLowerCase(), left.title.toLowerCase()) || left.publicId - right.publicId;
			case 'bpm_asc':
				return Number(left.bpm === null) - Number(right.bpm === null) || (left.bpm ?? 0) - (right.bpm ?? 0) || left.publicId - right.publicId;
			case 'bpm_desc':
				return Number(left.bpm === null) - Number(right.bpm === null) || (right.bpm ?? 0) - (left.bpm ?? 0) || left.publicId - right.publicId;
			case 'newest':
				return right.createdAt - left.createdAt || right.publicId - left.publicId;
		}
	});
	return records.map((record) => ({
		id: record.publicId,
		title: record.title,
		artist: 'query_owner',
		coverImageUrl: record.coverImage
			? `/api/tracks/${record.publicId}/cover`
			: null,
		bpm: record.bpm,
		musicalKey: record.musicalKey,
		genre: record.genre,
		description: record.description,
		fileSizeBytes: record.fileSizeBytes,
		ownerUsername: 'query_owner',
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString()
	}));
}

async function main() {
	const config = readMongoConfig(process.env);
	const databaseName = ownedDatabaseName(config.testDatabaseName, config.databaseName);
	const manager = new MongoClientManager({ ...config, testDatabaseName: databaseName });
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
			collections.users.createIndexes([...MONGODB_INDEX_DEFINITIONS.users], { maxTimeMS: OPERATION_TIMEOUT_MS }),
			collections.tracks.createIndexes([...MONGODB_INDEX_DEFINITIONS.tracks], { maxTimeMS: OPERATION_TIMEOUT_MS })
		]);
		const ownerId = randomUUID();
		const definitions = seedDefinitions(ownerId);
		await collections.users.insertOne({
			_id: ownerId,
			username: 'query_owner',
			email: 'query.owner@example.test',
			passwordHash: 'synthetic-hash',
			createdAt: new Date('2026-07-27T10:00:00.000Z'),
			updatedAt: new Date('2026-07-27T10:00:00.000Z')
		});
		await collections.tracks.insertMany(definitions);
		const repository = createMongoTrackRepository(
			collections.tracks,
			collections.counters,
			collections.users,
			{ timeoutMS: OPERATION_TIMEOUT_MS }
		);

		async function behavior(label, query, assertion = () => undefined) {
			await check(label, async () => {
				const actual = normalized(await repository.listPublicTracks(query));
				assert.deepEqual(actual, expectedRecords(definitions, query));
				await assertion(actual);
			});
		}

		await behavior('default public listing', { sort: DEFAULT_TRACK_SORT });
		await behavior(
			'cover URL and legacy cover compatibility',
			{ sort: 'oldest' },
			(records) => {
				assert.equal(
					records.find(({ id }) => id === 1)?.coverImageUrl,
					'/api/tracks/1/cover'
				);
				assert.equal(
					records.find(({ id }) => id === 2)?.coverImageUrl,
					null
				);
				assert.equal(
					records.find(({ id }) => id === 7)?.coverImageUrl,
					null
				);
				assert.equal(
					Object.hasOwn(
						definitions.find(({ publicId }) => publicId === 7) ?? {},
						'coverImage'
					),
					false
				);
			}
		);
		await behavior('private tracks excluded', { sort: 'newest' }, (records) =>
			assert.equal(records.some(({ title }) => title.startsWith('Private')), false));
		await behavior('title substring search', { q: 'pulse', sort: 'newest' });
		await behavior('uploader substring search', { q: 'query_owner', sort: 'newest' }, (records) => {
			assert.equal(records.length, 6);
			assert.equal(records.every(({ artist }) => artist === 'query_owner'), true);
		});
		await behavior('description substring search', { q: 'sunset', sort: 'newest' });
		await behavior('ASCII case behavior', { q: 'ALPHA PULSE', sort: 'newest' });
		await behavior('literal percent search', { q: '%', sort: 'newest' });
		await behavior('literal underscore search', { q: '_mix', sort: 'newest' });
		await behavior('literal backslash search', { q: String.raw`Back\slash`, sort: 'newest' });
		await behavior('literal regex metacharacter search', { q: '.*+?^$()[]{}|', sort: 'newest' });
		await behavior('inclusive BPM minimum', { bpmMin: 120, sort: 'newest' });
		await behavior('inclusive BPM maximum', { bpmMax: 120, sort: 'newest' });
		await behavior('equal BPM boundaries', { bpmMin: 120, bpmMax: 120, sort: 'newest' });
		await behavior('combined BPM range', { bpmMin: 100, bpmMax: 130, sort: 'newest' });
		await behavior('missing BPM filter behavior', { bpmMin: 20, sort: 'newest' }, (records) =>
			assert.equal(records.every(({ bpm }) => bpm !== null), true));
		await behavior('musical-key equality', { musicalKey: 'A minor', sort: 'newest' });
		await behavior('genre equality', { genre: 'House', sort: 'newest' });
		await behavior('search plus BPM', { q: 'needle', bpmMin: 120, sort: 'newest' });
		await behavior('search plus key and genre', { q: 'needle', musicalKey: 'A minor', genre: 'House', sort: 'newest' });
		await behavior('all supported filters combined', { q: 'needle', bpmMin: 120, bpmMax: 120, musicalKey: 'A minor', genre: 'House', sort: 'oldest' });
		await behavior('newest sorting', { sort: 'newest' });
		await behavior('oldest sorting', { sort: 'oldest' });
		await behavior('title ascending sorting', { sort: 'title_asc' });
		await behavior('title descending sorting', { sort: 'title_desc' });
		await behavior('BPM ascending with nulls last', { sort: 'bpm_asc' }, (records) => assert.equal(records.at(-1)?.bpm, null));
		await behavior('BPM descending with nulls last', { sort: 'bpm_desc' }, (records) => assert.equal(records.at(-1)?.bpm, null));
		await behavior('deterministic public-ID tie ordering', { bpmMin: 120, bpmMax: 120, sort: 'bpm_asc' });
		await behavior('empty search behaves as absent', { q: '', sort: 'newest' });
		await behavior('no-result query', { q: 'definitely absent', sort: 'newest' }, (records) => assert.equal(records.length, 0));
		await check('regex search input is escaped literally', () => {
			assert.equal(escapeRegexSearchTerm('.*+?^$()[]{}|'), String.raw`\.\*\+\?\^\$\(\)\[\]\{\}\|`);
			assert.equal(TRACK_SORTS.length, 6);
		});
		await behavior('public-safe projection', { q: 'Zulu', sort: 'newest' }, (records) =>
			assert.deepEqual(Object.keys(records[0] ?? {}).sort(), [
				'artist', 'bpm', 'coverImageUrl', 'createdAt', 'description', 'fileSizeBytes', 'genre',
				'id', 'musicalKey', 'ownerUsername', 'title', 'updatedAt'
			]));
		await check('development MongoDB safe aggregate hash remains unchanged', async () =>
			assert.equal(await developmentDigest(development), beforeDigest));

		const session = client.startSession();
		activeClientSessions += 1;
		await session.endSession();
		activeClientSessions -= 1;
	} catch (error) {
		primaryFailure = error;
	} finally {
		if (database) {
			try {
				activeStep = 'exact query database cleanup';
				await database.dropDatabase({ timeoutMS: OPERATION_TIMEOUT_MS });
				await check('exact query test database cleanup', () => undefined);
			} catch (error) {
				cleanupFailure = error;
			}
		}
		try {
			activeStep = 'query client cleanup';
			await manager.close(true);
			if (!primaryFailure) {
				await check('owned query MongoClient and ClientSession cleanup', () =>
					assert.equal(activeClientSessions, 0));
			}
		} catch (error) {
			cleanupFailure ??= error;
		}
		clearTimeout(watchdog);
	}
	if (primaryFailure) throw primaryFailure;
	if (cleanupFailure) throw cleanupFailure;
	assert.equal(checkNumber, EXPECTED_CHECKS);
	console.log(`MongoDB query integration passed ${checkNumber}/${EXPECTED_CHECKS}.`);
}

main().catch((error) => {
	console.error(safeError(error));
	process.exitCode = 1;
});

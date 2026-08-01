import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { MongoClientManager } from '../src/lib/server/mongodb/client.ts';
import { readMongoConfig } from '../src/lib/server/mongodb/config.ts';
import { getMongoCollections } from '../src/lib/server/mongodb/collections.ts';
import {
	TRACK_PUBLIC_ID_COUNTER
} from '../src/lib/server/mongodb/documents.ts';
import { MONGODB_INDEX_DEFINITIONS } from '../src/lib/server/mongodb/indexes.ts';
import { safeMongoAggregateFingerprint } from './lib/mongodb-fingerprint.mjs';

function configuredPath(value, fallback) {
	const candidate = value?.trim() || fallback;
	return isAbsolute(candidate) ? resolve(candidate) : resolve(candidate);
}

function contained(root, path) {
	const rel = relative(root, path);
	return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

async function audioAudit(root, storageKeys) {
	const files = [];
	async function visit(directory) {
		if (!existsSync(directory)) return;
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const absolute = resolve(directory, entry.name);
			assert.ok(contained(root, absolute));
			if (entry.isDirectory()) await visit(absolute);
			else if (entry.isFile()) files.push(absolute);
		}
	}
	await visit(root);
	files.sort((a, b) => relative(root, a).localeCompare(relative(root, b)));

	let bytes = 0;
	const aggregate = createHash('sha256');
	const relativeFiles = new Set();
	for (const path of files) {
		const rel = relative(root, path).split(sep).join('/');
		const info = await stat(path);
		const contents = await readFile(path);
		bytes += info.size;
		relativeFiles.add(rel);
		aggregate.update(String(info.size));
		aggregate.update('\0');
		aggregate.update(contents);
	}

	let existingReferences = 0;
	let missingReferences = 0;
	for (const storageKey of storageKeys) {
		const path = resolve(root, storageKey);
		assert.ok(contained(root, path));
		if (existsSync(path)) existingReferences += 1;
		else missingReferences += 1;
	}

	return {
		fileCount: files.length,
		byteSize: bytes,
		contentHash: aggregate.digest('hex'),
		contained: true,
		existingReferences,
		missingReferences,
		unexpectedFiles: [...relativeFiles].filter(
			(path) => !storageKeys.has(path)
		).length
	};
}

const config = readMongoConfig(process.env);
const manager = new MongoClientManager(config);
try {
	const client = await manager.connect();
	const database = client.db(config.databaseName);
	const collections = getMongoCollections(database);
	const aggregateBefore = await safeMongoAggregateFingerprint(collections);
	const hello = await client
		.db('admin')
		.command({ hello: 1 }, { timeoutMS: 5_000 });
	const [userCount, sessionCount, trackCount, playlistCount, playlistItemCount, maximum, counter, marker, tracks] =
		await Promise.all([
			collections.users.countDocuments({}, { timeoutMS: 5_000 }),
			collections.sessions.countDocuments({}, { timeoutMS: 5_000 }),
			collections.tracks.countDocuments({}, { timeoutMS: 5_000 }),
			collections.playlists.countDocuments({}, { timeoutMS: 5_000 }),
			collections.playlistItems.countDocuments({}, { timeoutMS: 5_000 }),
			collections.tracks
				.find({}, { projection: { _id: 0, publicId: 1 }, timeoutMS: 5_000 })
				.sort({ publicId: -1 })
				.limit(1)
				.next(),
			collections.counters.findOne(
				{ _id: TRACK_PUBLIC_ID_COUNTER },
				{ projection: { _id: 0, value: 1 }, timeoutMS: 5_000 }
			),
			collections.migrations.findOne(
				{ version: 1 },
				{
					projection: {
						_id: 0,
						fingerprint: 1,
						maxPublicId: 1,
						trackCount: 1,
						userCount: 1,
						version: 1
					},
					timeoutMS: 5_000
				}
			),
			collections.tracks
				.find({}, { projection: { _id: 0, storageKey: 1 }, timeoutMS: 5_000 })
				.toArray()
		]);

	const expectedIndexes = {
		users: MONGODB_INDEX_DEFINITIONS.users.map(({ name }) => name),
		sessions: MONGODB_INDEX_DEFINITIONS.sessions.map(({ name }) => name),
		tracks: MONGODB_INDEX_DEFINITIONS.tracks.map(({ name }) => name),
		playlists: MONGODB_INDEX_DEFINITIONS.playlists.map(({ name }) => name),
		playlistItems: MONGODB_INDEX_DEFINITIONS.playlistItems.map(({ name }) => name)
	};
	const actualIndexes = {
		users: (await collections.users.indexes()).map(({ name }) => name),
		sessions: (await collections.sessions.indexes()).map(({ name }) => name),
		tracks: (await collections.tracks.indexes()).map(({ name }) => name),
		playlists: (await collections.playlists.indexes()).map(({ name }) => name),
		playlistItems: (await collections.playlistItems.indexes()).map(({ name }) => name)
	};
	const indexesVerified = Object.entries(expectedIndexes).every(
		([collection, names]) =>
			names.every((name) => actualIndexes[collection].includes(name))
	);
	const audioRoot = configuredPath(process.env.AUDIO_STORAGE_PATH, 'storage/audio');
	const audio = await audioAudit(
		audioRoot,
		new Set(tracks.map(({ storageKey }) => storageKey.split('\\').join('/')))
	);
	const aggregateAfter = await safeMongoAggregateFingerprint(collections);
	const markerComplete =
		marker?.version === 1 &&
		marker.userCount === userCount &&
		marker.trackCount === trackCount &&
		marker.maxPublicId === (maximum?.publicId ?? 0) &&
		typeof marker.fingerprint === 'string' &&
		marker.fingerprint.length > 0;
	assert.ok(indexesVerified);
	assert.ok(markerComplete);
	assert.equal(aggregateAfter, aggregateBefore);
	assert.ok((counter?.value ?? -1) >= (maximum?.publicId ?? 0));
	assert.equal(audio.missingReferences, 0);

	console.log(
		JSON.stringify(
			{
				writesPerformed: false,
				mongo: {
					primary: hello.isWritablePrimary === true,
					transactionCapable:
						typeof hello.setName === 'string' || hello.msg === 'isdbgrid',
					userCount,
					sessionCount,
					trackCount,
					playlistCount,
					playlistItemCount,
					maxPublicId: maximum?.publicId ?? 0,
					counterCompatible:
						(counter?.value ?? -1) >= (maximum?.publicId ?? 0),
					migrationMarkerComplete: markerComplete,
					aggregateStableDuringAudit: aggregateAfter === aggregateBefore,
					indexesVerified
				},
				audio: {
					fileCount: audio.fileCount,
					byteSize: audio.byteSize,
					contentHashComputed: audio.contentHash.length > 0,
					contained: audio.contained,
					existingReferences: audio.existingReferences,
					missingReferences: audio.missingReferences,
					unexpectedFiles: audio.unexpectedFiles
				}
			},
			null,
			2
		)
	);
} finally {
	await manager.close(true);
}

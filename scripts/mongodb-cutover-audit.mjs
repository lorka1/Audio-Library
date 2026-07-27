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
	SQLITE_MONGODB_MIGRATION_ID,
	TRACK_PUBLIC_ID_COUNTER
} from '../src/lib/server/mongodb/documents.ts';
import { MONGODB_INDEX_DEFINITIONS } from '../src/lib/server/mongodb/indexes.ts';
import {
	readSqliteMigrationSnapshot,
	resolveSqliteSource,
	verifyMigration
} from './lib/sqlite-mongodb-migration.mjs';

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
	const [userCount, sessionCount, trackCount, maximum, counter, marker, tracks] =
		await Promise.all([
			collections.users.countDocuments({}, { timeoutMS: 5_000 }),
			collections.sessions.countDocuments({}, { timeoutMS: 5_000 }),
			collections.tracks.countDocuments({}, { timeoutMS: 5_000 }),
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
				{ _id: SQLITE_MONGODB_MIGRATION_ID },
				{ projection: { _id: 0, fingerprint: 1, version: 1 }, timeoutMS: 5_000 }
			),
			collections.tracks
				.find({}, { projection: { _id: 0, storageKey: 1 }, timeoutMS: 5_000 })
				.toArray()
		]);

	const expectedIndexes = {
		users: MONGODB_INDEX_DEFINITIONS.users.map(({ name }) => name),
		sessions: MONGODB_INDEX_DEFINITIONS.sessions.map(({ name }) => name),
		tracks: MONGODB_INDEX_DEFINITIONS.tracks.map(({ name }) => name)
	};
	const actualIndexes = {
		users: (await collections.users.indexes()).map(({ name }) => name),
		sessions: (await collections.sessions.indexes()).map(({ name }) => name),
		tracks: (await collections.tracks.indexes()).map(({ name }) => name)
	};
	const indexesVerified = Object.entries(expectedIndexes).every(
		([collection, names]) =>
			names.every((name) => actualIndexes[collection].includes(name))
	);
	const audioRoot = configuredPath(process.env.AUDIO_STORAGE_PATH, 'storage/audio');
	const opened = await readSqliteMigrationSnapshot({
		sourcePath: resolveSqliteSource(process.env.DATABASE_URL),
		audioStoragePath: audioRoot
	});
	let migrationVerification;
	try {
		migrationVerification = await verifyMigration({
			snapshot: opened.snapshot,
			analysis: opened.analysis,
			collections
		});
	} finally {
		opened.close();
	}
	const audio = await audioAudit(
		audioRoot,
		new Set(tracks.map(({ storageKey }) => storageKey.split('\\').join('/')))
	);
	assert.ok(indexesVerified);
	assert.ok(migrationVerification.ok);
	assert.ok((counter?.value ?? -1) >= (maximum?.publicId ?? 0));
	assert.equal(audio.missingReferences, 0);

	console.log(
		JSON.stringify(
			{
				writesPerformed: false,
				mongo: {
					userCount,
					sessionCount,
					trackCount,
					maxPublicId: maximum?.publicId ?? 0,
					counterCompatible:
						(counter?.value ?? -1) >= (maximum?.publicId ?? 0),
					migrationMarkerComplete:
						marker?.version === 1 && migrationVerification.checks.marker,
					fingerprintVerified:
						migrationVerification.checks.records &&
						migrationVerification.checks.marker,
					indexesVerified
				},
				audio
			},
			null,
			2
		)
	);
} finally {
	await manager.close(true);
}

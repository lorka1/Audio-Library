import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClientManager } from '../src/lib/server/mongodb/client.ts';
import {
	assertMongoTestDatabaseName,
	readMongoConfig
} from '../src/lib/server/mongodb/config.ts';
import { getMongoCollections } from '../src/lib/server/mongodb/collections.ts';
import { TRACK_PUBLIC_ID_COUNTER } from '../src/lib/server/mongodb/documents.ts';
import { ensureMongoIndexes } from '../src/lib/server/mongodb/indexes.ts';
import { verifyMongoOperationalState } from '../src/lib/server/mongodb/verification.ts';
import { createMongoPlaylistRepository } from '../src/lib/server/playlists/mongodb-repository.ts';
import { createMongoTrackRepository } from '../src/lib/server/tracks/mongodb-repository.ts';

const config = readMongoConfig(process.env);
const suffix = `_playlists_${randomBytes(6).toString('hex')}`;
const databaseName = `${config.testDatabaseName.slice(0, 63 - suffix.length)}${suffix}`;
assertMongoTestDatabaseName(databaseName, config.databaseName);
const manager = new MongoClientManager(config);
let initialTestDatabases;
let existedBefore = false;
let primaryFailure;
const cleanupFailures = [];

function trackDocument({ id, publicId, ownerId, visibility, title }) {
	const now = new Date('2026-07-30T12:00:00.000Z');
	return {
		_id: id,
		publicId,
		ownerId,
		title,
		artist: 'Synthetic playlist artist',
		bpm: null,
		musicalKey: null,
		genre: null,
		description: null,
		originalFilename: `${publicId}.mp3`,
		storageKey: `${randomUUID()}.mp3`,
		mimeType: 'audio/mpeg',
		fileSizeBytes: 64,
		durationMs: null,
		coverImage: null,
		visibility,
		createdAt: now,
		updatedAt: now
	};
}

try {
	const client = await manager.connect();
	const listed = await client.db('admin').admin().listDatabases({ nameOnly: true });
	initialTestDatabases = listed.databases
		.map(({ name }) => name)
		.filter((name) => name.startsWith('audio_library_test_'))
		.sort();
	existedBefore = initialTestDatabases.includes(databaseName);
	assert.equal(existedBefore, false);
	const database = client.db(databaseName);
	const collections = getMongoCollections(database);
	await ensureMongoIndexes(collections, { maxTimeMS: 8_000 });
	await collections.counters.insertOne({ _id: TRACK_PUBLIC_ID_COUNTER, value: 3 });

	const now = new Date('2026-07-30T12:00:00.000Z');
	const ownerId = randomUUID();
	const otherOwnerId = randomUUID();
	await collections.users.insertMany([
		{
			_id: ownerId,
			username: 'synthetic_playlist_owner',
			email: 'synthetic-playlist-owner@example.invalid',
			passwordHash: 'synthetic-only',
			createdAt: now,
			updatedAt: now
		},
		{
			_id: otherOwnerId,
			username: 'synthetic_playlist_other',
			email: 'synthetic-playlist-other@example.invalid',
			passwordHash: 'synthetic-only',
			createdAt: now,
			updatedAt: now
		}
	]);
	const publicTrackId = randomUUID();
	const ownedPrivateTrackId = randomUUID();
	const inaccessibleTrackId = randomUUID();
	await collections.tracks.insertMany([
		trackDocument({ id: publicTrackId, publicId: 1, ownerId: otherOwnerId, visibility: 'public', title: 'Synthetic public track' }),
		trackDocument({ id: ownedPrivateTrackId, publicId: 2, ownerId, visibility: 'private', title: 'Synthetic owned private track' }),
		trackDocument({ id: inaccessibleTrackId, publicId: 3, ownerId: otherOwnerId, visibility: 'private', title: 'Synthetic inaccessible track' })
	]);

	let clock = now.getTime();
	const repository = createMongoPlaylistRepository(
		client,
		collections.playlists,
		collections.playlistItems,
		collections.tracks,
		{ now: () => new Date(clock += 1_000) }
	);
	const created = await repository.createPlaylist(ownerId, {
		name: 'Synthetic private playlist',
		description: null
	});
	assert.equal(created.trackCount, 0);
	assert.equal(Object.hasOwn(created, 'ownerId'), false);
	assert.equal(Object.hasOwn(created, '_id'), false);
	assert.equal((await repository.listPlaylistsForOwner(otherOwnerId)).length, 0);
	assert.equal(await repository.findPlaylistForOwner(otherOwnerId, created.publicId), null);
	assert.equal(
		await repository.updatePlaylistForOwner(otherOwnerId, created.publicId, {
			name: 'Not allowed',
			description: null
		}),
		null
	);

	assert.equal(await repository.addTrackToPlaylist(ownerId, created.publicId, 1), 'added');
	const afterFirstAdd = await repository.findPlaylistForOwner(ownerId, created.publicId);
	assert.ok(afterFirstAdd);
	assert.equal(await repository.addTrackToPlaylist(ownerId, created.publicId, 1), 'already-added');
	assert.equal(await repository.addTrackToPlaylist(ownerId, created.publicId, 2), 'added');
	assert.equal(await repository.addTrackToPlaylist(ownerId, created.publicId, 3), 'track-unavailable');
	assert.equal(await repository.addTrackToPlaylist(ownerId, created.publicId, 999), 'track-unavailable');
	assert.equal(await repository.addTrackToPlaylist(otherOwnerId, created.publicId, 1), 'not-found');
	assert.equal(await collections.playlistItems.countDocuments({ playlistId: (await collections.playlists.findOne({ publicId: created.publicId }))._id }), 2);

	const detail = await repository.findPlaylistForOwner(ownerId, created.publicId);
	assert.ok(detail);
	assert.equal(detail.tracks.length, 2);
	assert.ok(new Date(detail.updatedAt) > new Date(afterFirstAdd.updatedAt));
	const serialized = JSON.stringify(detail);
	for (const secret of [ownerId, otherOwnerId, publicTrackId, ownedPrivateTrackId, inaccessibleTrackId, 'storageKey', 'originalFilename']) {
		assert.equal(serialized.includes(secret), false);
	}
	const memberships = await repository.getTrackPlaylistMembership(ownerId, 1);
	assert.deepEqual(memberships, [created.publicId]);
	assert.deepEqual(await repository.getTrackPlaylistMembership(otherOwnerId, 1), []);

	assert.equal(await repository.removeTrackFromPlaylist(otherOwnerId, created.publicId, 1), 'not-found');
	assert.equal(await repository.removeTrackFromPlaylist(ownerId, created.publicId, 1), 'removed');
	assert.equal(await repository.removeTrackFromPlaylist(ownerId, created.publicId, 1), 'not-present');
	const renamed = await repository.updatePlaylistForOwner(ownerId, created.publicId, {
		name: 'Synthetic renamed playlist',
		description: 'Synthetic description'
	});
	assert.equal(renamed?.name, 'Synthetic renamed playlist');

	const cleanupPlaylist = await repository.createPlaylist(ownerId, { name: 'Track cleanup fixture', description: null });
	assert.equal(await repository.addTrackToPlaylist(ownerId, cleanupPlaylist.publicId, 2), 'added');
	const trackRepository = createMongoTrackRepository(
		collections.tracks,
		collections.counters,
		collections.users,
		{ client, playlistItems: collections.playlistItems }
	);
	assert.equal(await trackRepository.deleteOwnerTrack(2, ownerId), true);
	assert.equal(await collections.playlistItems.countDocuments({ trackId: ownedPrivateTrackId }), 0);
	assert.equal(await collections.playlistItems.countDocuments({}), 0);

	const deleteFixture = await repository.createPlaylist(ownerId, { name: 'Delete fixture', description: null });
	assert.equal(await repository.addTrackToPlaylist(ownerId, deleteFixture.publicId, 1), 'added');
	assert.equal(await repository.deletePlaylistForOwner(otherOwnerId, deleteFixture.publicId), false);
	assert.notEqual(await repository.findPlaylistForOwner(ownerId, deleteFixture.publicId), null);
	assert.equal(await repository.deletePlaylistForOwner(ownerId, deleteFixture.publicId), true);
	assert.equal(await repository.findPlaylistForOwner(ownerId, deleteFixture.publicId), null);
	assert.equal(await collections.playlistItems.countDocuments({}), 0);

	await verifyMongoOperationalState(client, database);
	console.log('MONGODB_PLAYLISTS_INTEGRATION_PASSED=1');
} catch (error) {
	primaryFailure = error;
} finally {
	try {
		const client = await manager.connect();
		const listed = await client.db('admin').admin().listDatabases({ nameOnly: true });
		if (!existedBefore && listed.databases.some(({ name }) => name === databaseName)) {
			await client.db(databaseName).dropDatabase({ timeoutMS: 10_000 });
		}
		const after = (await client.db('admin').admin().listDatabases({ nameOnly: true }))
			.databases.map(({ name }) => name)
			.filter((name) => name.startsWith('audio_library_test_'))
			.sort();
		assert.deepEqual(after, initialTestDatabases);
	} catch (error) {
		cleanupFailures.push(error);
	}
	await manager.close(true).catch((error) => cleanupFailures.push(error));
}

if (primaryFailure && cleanupFailures.length > 0) {
	throw new AggregateError([primaryFailure, ...cleanupFailures], 'Playlist integration and cleanup failed.');
}
if (primaryFailure) throw primaryFailure;
if (cleanupFailures.length > 0) throw new AggregateError(cleanupFailures, 'Playlist integration cleanup failed.');

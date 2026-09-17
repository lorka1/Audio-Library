import assert from 'node:assert/strict';
import test from 'node:test';
import { createMongoTrackRepository } from '../src/lib/server/tracks/mongodb-repository.ts';
import { createMongoPlaylistRepository } from '../src/lib/server/playlists/mongodb-repository.ts';
import { createMongoAdminRepository } from '../src/lib/server/admin/mongodb-repository.ts';

const timestamp = new Date('2026-01-02T03:04:05.000Z');
const legacyTrack = {
	_id: 'track-7',
	publicId: 7,
	ownerId: 'owner-1',
	title: 'Legacy upload',
	artist: 'Ignored legacy artist',
	bpm: 120,
	musicalKey: null,
	genre: 'House',
	description: 'A track from an older document',
	originalFilename: 'legacy.mp3',
	storageKey: 'stored.mp3',
	mimeType: 'audio/mpeg',
	fileSizeBytes: 42,
	coverImage: { storageKey: 'cover.png', mimeType: 'image/png', byteSize: 24 },
	visibility: 'private',
	createdAt: timestamp,
	updatedAt: timestamp
};

test('legacy track state does not restrict browsing or media, and new writes omit it', async () => {
	const aggregateMatches = [];
	const aggregatePipelines = [];
	const lookupFilters = [];
	let inserted;
	const tracks = {
		aggregate(pipeline) {
			aggregateMatches.push(pipeline[0].$match);
			aggregatePipelines.push(pipeline);
			return { async toArray() { return [{
				...legacyTrack,
				artist: 'uploader',
				ownerUsername: 'uploader'
			}]; } };
		},
		async findOne(filter) {
			lookupFilters.push(filter);
			return filter.publicId === legacyTrack.publicId ? legacyTrack : null;
		},
		async insertOne(document) { inserted = document; }
	};
	const repository = createMongoTrackRepository(tracks, {}, { collectionName: 'users' });

	const listed = await repository.listTracks({ sort: 'newest' });
	const found = await repository.findTrackByPublicId(7);
	const streamed = await repository.findTrackForStreaming(7);
	const downloaded = await repository.findTrackForDownload(7);
	const cover = await repository.findTrackCover(7);
	assert.deepEqual(aggregateMatches, [{}, { publicId: 7 }]);
	assert.equal(listed[0].id, 7);
	assert.equal(found.id, 7);
	assert.deepEqual(lookupFilters, [{ publicId: 7 }, { publicId: 7 }, { publicId: 7 }]);
	assert.equal(streamed.storedFilename, 'stored.mp3');
	assert.equal(downloaded.originalFilename, 'legacy.mp3');
	assert.equal(cover.storageKey, 'cover.png');
	assert.equal(Object.hasOwn(streamed, 'visibility'), false);
	await repository.listTracks({
		sort: 'bpm_desc', q: 'legacy', bpmMin: 100, bpmMax: 130, genre: 'House'
	});
	assert.deepEqual(aggregateMatches[2], {
		bpm: { $gte: 100, $lte: 130 }, genre: 'House'
	});
	assert.equal(aggregatePipelines[2].some((stage) => stage.$match?.$or), true);
	assert.deepEqual(
		aggregatePipelines[2].find((stage) => stage.$sort)?.$sort,
		{ __bpmMissing: 1, bpm: -1, publicId: 1 }
	);

	await repository.createTrack({
		id: 'new-track', ownerId: 'owner-1', title: 'New upload', bpm: null,
		musicalKey: null, genre: null, description: null, originalFilename: 'new.mp3',
		storageKey: 'new-stored.mp3', mimeType: 'audio/mpeg', fileSizeBytes: 10,
		createdAt: timestamp, updatedAt: timestamp
	}, { publicId: 8 });
	assert.equal(Object.hasOwn(inserted, 'visibility'), false);
});

test('track edits and deletions keep owner-scoped MongoDB filters', async () => {
	const mutationFilters = [];
	const tracks = {
		async findOneAndUpdate(filter) {
			mutationFilters.push(filter);
			return { publicId: 7 };
		},
		aggregate() { return { async toArray() { return [{ ...legacyTrack, artist: 'uploader' }]; } }; },
		async deleteOne(filter) {
			mutationFilters.push(filter);
			return { deletedCount: 1 };
		}
	};
	const repository = createMongoTrackRepository(tracks, {}, { collectionName: 'users' });
	await repository.updateOwnerTrackMetadata(7, 'owner-1', {
		title: 'Edited', bpm: 120, musicalKey: null, genre: null,
		description: null, updatedAt: timestamp
	});
	await repository.deleteOwnerTrack(7, 'owner-1');
	assert.deepEqual(mutationFilters, [
		{ publicId: 7, ownerId: 'owner-1' },
		{ publicId: 7, ownerId: 'owner-1' }
	]);
});

test('playlist membership accepts legacy tracks while playlist access stays owner scoped', async () => {
	const playlistFilters = [];
	const trackFilters = [];
	let added = 0;
	const client = { startSession() { return {
		async withTransaction(work) { await work(this); },
		async endSession() {}
	}; } };
	const playlists = {
		async findOne(filter) {
			playlistFilters.push(filter);
			return filter.ownerId === 'owner-1' ? { _id: 'playlist-1' } : null;
		},
		async updateOne() {}
	};
	const playlistItems = {
		async findOne() { return null; },
		async insertOne() { added += 1; }
	};
	const tracks = {
		async findOne(filter) {
			trackFilters.push(filter);
			return legacyTrack;
		}
	};
	const repository = createMongoPlaylistRepository(
		client, playlists, playlistItems, tracks, { collectionName: 'users' }
	);
	assert.equal(await repository.addTrackToPlaylist('owner-1', 'validPlaylistId1234567890', 7), 'added');
	assert.equal(await repository.addTrackToPlaylist('other-user', 'validPlaylistId1234567890', 7), 'not-found');
	assert.equal(added, 1);
	assert.deepEqual(trackFilters, [{ publicId: 7 }]);
	assert.deepEqual(playlistFilters, [
		{ ownerId: 'owner-1', publicId: 'validPlaylistId1234567890' },
		{ ownerId: 'other-user', publicId: 'validPlaylistId1234567890' }
	]);
});

test('a legacy track stays in its playlist, while another user cannot open that playlist', async () => {
	const playlistFilters = [];
	const playlist = {
		_id: 'playlist-1', publicId: 'validPlaylistId1234567890', ownerId: 'owner-1',
		name: 'Personal list', description: null, createdAt: timestamp, updatedAt: timestamp
	};
	const playlists = {
		async findOne(filter) {
			playlistFilters.push(filter);
			return filter.ownerId === 'owner-1' ? playlist : null;
		}
	};
	const playlistItems = {
		aggregate() { return { async toArray() { return [{
			addedAt: timestamp,
			track: { ...legacyTrack, artist: 'uploader' }
		}]; } }; }
	};
	const repository = createMongoPlaylistRepository(
		{}, playlists, playlistItems, {}, { collectionName: 'users' }
	);
	const own = await repository.findPlaylistForOwner('owner-1', playlist.publicId);
	const foreign = await repository.findPlaylistForOwner('other-user', playlist.publicId);
	assert.equal(own.tracks.length, 1);
	assert.equal(own.tracks[0].id, 7);
	assert.equal(Object.hasOwn(own.tracks[0], 'visibility'), false);
	assert.equal(foreign, null);
	assert.deepEqual(playlistFilters, [
		{ ownerId: 'owner-1', publicId: playlist.publicId },
		{ ownerId: 'other-user', publicId: playlist.publicId }
	]);
});

test('admin totals include all tracks without separate state counts', async () => {
	const trackCountFilters = [];
	const adminPipelines = [];
	const collections = {
		users: { async countDocuments() { return 2; } },
		tracks: {
			async countDocuments(filter) { trackCountFilters.push(filter); return 1; },
			aggregate(pipeline) {
				adminPipelines.push(pipeline);
				return { async toArray() { return [{
					...legacyTrack,
					artist: 'uploader',
					ownerUsername: 'uploader'
				}]; } };
			}
		},
		playlists: { async countDocuments() { return 3; } }
	};
	const repository = createMongoAdminRepository(collections);
	assert.deepEqual(await repository.getDashboardStats(), {
		totalUsers: 2,
		totalTracks: 1,
		totalPlaylists: 3
	});
	assert.deepEqual(trackCountFilters, [{}]);
	const listed = await repository.listTracks();
	assert.equal(listed.length, 1);
	assert.equal(Object.hasOwn(listed[0], 'visibility'), false);
	assert.equal(adminPipelines[0].some((stage) => stage.$match), false);
});

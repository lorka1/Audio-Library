import assert from 'node:assert/strict';
import test from 'node:test';
import { get } from 'svelte/store';
import { deleteAdminUser } from '../src/lib/server/admin/user-deletion.ts';
import { UserDeletionChangedError } from '../src/lib/server/admin/contract.ts';
import { createAudioPlayerController } from '../src/lib/player/controller.ts';

const snapshot = {
	userId: 'target-1',
	username: 'listener',
	tracks: [
		{ id: 'track-1', publicId: 11, storedFilename: 'audio-1', coverImage: { storageKey: 'cover-1', mimeType: 'image/png', byteSize: 1 } },
		{ id: 'track-2', publicId: 12, storedFilename: 'audio-2', coverImage: null }
	],
	playlists: [{ id: 'playlist-1', imageStorageKey: 'playlist-image-1' }]
};

function fixture({ target = snapshot, failTrack = null, failDatabase = null, failFinalize = false } = {}) {
	const active = new Set(['audio-1', 'audio-2', 'cover-1', 'playlist-image-1', 'unrelated-audio']);
	const quarantined = new Set();
	const events = [];
	const move = (key) => {
		if (!active.delete(key)) return false;
		quarantined.add(key);
		return true;
	};
	const restore = (key) => {
		if (quarantined.delete(key)) active.add(key);
	};
	const finalize = (key) => {
		if (failFinalize && key === 'audio-2') return false;
		quarantined.delete(key);
		return true;
	};
	const dependencies = {
		async findSnapshot(userId) {
			events.push(`lookup:${userId}`);
			return target;
		},
		async deleteDatabase(value) {
			events.push('database');
			assert.equal(value, target);
			assert.equal(quarantined.size, target.tracks.length + 2);
			if (failDatabase) throw failDatabase;
			return true;
		},
		async prepareTrackMedia(track) {
			events.push(`prepare:${track.publicId}`);
			if (track.id === failTrack) return null;
			const keys = [track.storedFilename, track.coverImage?.storageKey].filter(Boolean);
			for (const key of keys) move(key);
			return {
				async restore() {
					events.push(`restore:${track.publicId}`);
					for (const key of keys) restore(key);
					return true;
				},
				async finalize() {
					events.push(`finalize:${track.publicId}`);
					return keys.map(finalize).every(Boolean);
				}
			};
		},
		async quarantinePlaylistImage(key) {
			events.push(`prepare:${key}`);
			move(key);
			return { success: true, state: 'quarantined', file: { originalPath: key, quarantinePath: key } };
		},
		async restorePlaylistImage(file) {
			events.push(`restore:${file.originalPath}`);
			restore(file.originalPath);
		},
		async deleteQuarantinedPlaylistImage(file) {
			events.push(`finalize:${file.originalPath}`);
			finalize(file.originalPath);
		}
	};
	return { active, quarantined, events, dependencies };
}

test('admin cannot delete their own account even with a direct action request', async () => {
	const state = fixture();
	assert.deepEqual(await deleteAdminUser('admin-1', 'admin-1', state.dependencies), {
		success: false,
		status: 403,
		message: 'You cannot delete your own account.'
	});
	assert.deepEqual(state.events, []);
});

test('deleting multiple tracks and an imaged playlist finalizes only target media and reports track IDs', async () => {
	const state = fixture();
	const result = await deleteAdminUser('target-1', 'admin-1', state.dependencies);
	assert.deepEqual(result, { success: true, deletedTrackIds: [11, 12], cleanupPending: false });
	assert.deepEqual([...state.active], ['unrelated-audio']);
	assert.equal(state.quarantined.size, 0);
	assert.ok(state.events.indexOf('database') > state.events.indexOf('prepare:playlist-image-1'));
	assert.ok(state.events.indexOf('finalize:11') > state.events.indexOf('database'));

	const unrelatedPlayer = createAudioPlayerController();
	unrelatedPlayer.toggleTrack({ id: 99, title: 'Other', artist: 'Other', coverImageUrl: null, streamUrl: '/stream/99', detailsUrl: '/tracks/99' });
	const previous = get(unrelatedPlayer);
	unrelatedPlayer.clearIfTrackIds(result.deletedTrackIds);
	assert.equal(get(unrelatedPlayer), previous);

	const affectedPlayer = createAudioPlayerController();
	affectedPlayer.toggleTrack({ id: 12, title: 'Deleted', artist: 'Deleted', coverImageUrl: null, streamUrl: '/stream/12', detailsUrl: '/tracks/12' });
	affectedPlayer.clearIfTrackIds(result.deletedTrackIds);
	assert.equal(get(affectedPlayer).track, null);
});

test('a user without tracks or playlists can be deleted', async () => {
	const state = fixture({ target: { userId: 'empty-1', username: 'empty', tracks: [], playlists: [] } });
	state.dependencies.deleteDatabase = async () => true;
	assert.deepEqual(await deleteAdminUser('empty-1', 'admin-1', state.dependencies), {
		success: true,
		deletedTrackIds: [],
		cleanupPending: false
	});
});

test('a missing user returns 404 without touching files or database', async () => {
	const state = fixture({ target: null });
	assert.equal((await deleteAdminUser('missing-1', 'admin-1', state.dependencies)).status, 404);
	assert.deepEqual(state.events, ['lookup:missing-1']);
	assert.equal(state.active.size, 5);
});

test('media preparation failure restores previously quarantined files and leaves database untouched', async () => {
	const state = fixture({ failTrack: 'track-2' });
	assert.equal((await deleteAdminUser('target-1', 'admin-1', state.dependencies)).status, 500);
	assert.equal(state.active.size, 5);
	assert.equal(state.quarantined.size, 0);
	assert.ok(!state.events.includes('database'));
});

test('playlist image quarantine failure restores all track media before any database write', async () => {
	const state = fixture();
	state.dependencies.quarantinePlaylistImage = async () => ({ success: false, reason: 'unavailable' });
	assert.equal((await deleteAdminUser('target-1', 'admin-1', state.dependencies)).status, 500);
	assert.equal(state.active.size, 5);
	assert.equal(state.quarantined.size, 0);
	assert.ok(!state.events.includes('database'));
});

test('database transaction failure restores all quarantined media', async () => {
	const state = fixture({ failDatabase: new Error('transaction failed') });
	assert.equal((await deleteAdminUser('target-1', 'admin-1', state.dependencies)).status, 500);
	assert.equal(state.active.size, 5);
	assert.equal(state.quarantined.size, 0);
	assert.ok(state.events.includes('restore:playlist-image-1'));
});

test('if another deletion already removed the account, held media is finalized instead of restored', async () => {
	const state = fixture();
	state.dependencies.deleteDatabase = async () => false;
	const result = await deleteAdminUser('target-1', 'admin-1', state.dependencies);
	assert.equal(result.success, true);
	assert.deepEqual([...state.active], ['unrelated-audio']);
	assert.equal(state.quarantined.size, 0);
});

test('concurrent account changes return 409 after restoring media', async () => {
	const state = fixture({ failDatabase: new UserDeletionChangedError() });
	assert.equal((await deleteAdminUser('target-1', 'admin-1', state.dependencies)).status, 409);
	assert.equal(state.active.size, 5);
	assert.equal(state.quarantined.size, 0);
});

test('post-commit file cleanup failure is reported without restoring files referenced by deleted records', async () => {
	const state = fixture({ failFinalize: true });
	const result = await deleteAdminUser('target-1', 'admin-1', state.dependencies);
	assert.equal(result.success, true);
	assert.equal(result.cleanupPending, true);
	assert.deepEqual([...state.quarantined], ['audio-2']);
	assert.deepEqual([...state.active], ['unrelated-audio']);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMongoAdminRepository } from '../src/lib/server/admin/mongodb-repository.ts';
import { UserDeletionChangedError } from '../src/lib/server/admin/contract.ts';

function matches(row, filter) {
	if (filter.$or) return filter.$or.some((part) => matches(row, part));
	return Object.entries(filter).every(([field, expected]) =>
		expected && typeof expected === 'object' && '$in' in expected
			? expected.$in.includes(row[field])
			: row[field] === expected
	);
}

function fixture({ failSessions = false } = {}) {
	const rows = {
		users: [
			{ _id: 'target-1', username: 'target' },
			{ _id: 'admin-1', username: 'admin' },
			{ _id: 'other-1', username: 'other' }
		],
		sessions: [
			{ _id: 'session-1', userId: 'target-1' },
			{ _id: 'session-2', userId: 'target-1' },
			{ _id: 'session-3', userId: 'other-1' }
		],
		tracks: [
			{ _id: 'track-1', ownerId: 'target-1', publicId: 11, storageKey: 'audio-1', coverImage: { storageKey: 'cover-1', mimeType: 'image/png', byteSize: 1 } },
			{ _id: 'track-2', ownerId: 'target-1', publicId: 12, storageKey: 'audio-2' },
			{ _id: 'track-3', ownerId: 'other-1', publicId: 13, storageKey: 'audio-3' }
		],
		playlists: [
			{ _id: 'playlist-1', ownerId: 'target-1', image: { storageKey: 'image-1' } },
			{ _id: 'playlist-2', ownerId: 'other-1', image: null }
		],
		playlistItems: [
			{ _id: 'item-1', playlistId: 'playlist-1', trackId: 'track-1' },
			{ _id: 'item-2', playlistId: 'playlist-2', trackId: 'track-1' },
			{ _id: 'item-3', playlistId: 'playlist-2', trackId: 'track-3' }
		]
	};
	const operations = [];
	const collection = (name) => ({
		async findOne(filter) {
			return rows[name].find((row) => matches(row, filter)) ?? null;
		},
		find(filter) {
			return { async toArray() { return rows[name].filter((row) => matches(row, filter)); } };
		},
		async deleteMany(filter, options) {
			assert.ok(options.session);
			operations.push(`deleteMany:${name}`);
			if (failSessions && name === 'sessions') throw new Error('session deletion failed');
			const before = rows[name].length;
			rows[name] = rows[name].filter((row) => !matches(row, filter));
			return { deletedCount: before - rows[name].length };
		},
		async deleteOne(filter, options) {
			assert.ok(options.session);
			operations.push(`deleteOne:${name}`);
			const index = rows[name].findIndex((row) => matches(row, filter));
			if (index < 0) return { deletedCount: 0 };
			rows[name].splice(index, 1);
			return { deletedCount: 1 };
		}
	});
	let ended = false;
	const client = {
		startSession() {
			return {
				async withTransaction(callback) {
					const before = structuredClone(rows);
					try {
						await callback();
					} catch (error) {
						for (const [name, documents] of Object.entries(before)) rows[name] = documents;
						throw error;
					}
				},
				async endSession() { ended = true; }
			};
		}
	};
	const repository = createMongoAdminRepository({
		users: collection('users'),
		sessions: collection('sessions'),
		tracks: collection('tracks'),
		playlists: collection('playlists'),
		playlistItems: collection('playlistItems')
	}, { client });
	return { rows, operations, repository, get ended() { return ended; } };
}

test('user deletion transaction removes owned records and cross-user track memberships only', async () => {
	const state = fixture();
	const snapshot = await state.repository.findUserDeletionSnapshot('target-1');
	assert.equal(snapshot.tracks.length, 2);
	assert.equal(snapshot.tracks[0].coverImage.storageKey, 'cover-1');
	assert.equal(snapshot.playlists[0].imageStorageKey, 'image-1');
	assert.equal(await state.repository.deleteUserCascade(snapshot), true);
	assert.deepEqual(state.rows.users.map((row) => row._id), ['admin-1', 'other-1']);
	assert.deepEqual(state.rows.sessions.map((row) => row._id), ['session-3']);
	assert.deepEqual(state.rows.tracks.map((row) => row._id), ['track-3']);
	assert.deepEqual(state.rows.playlists.map((row) => row._id), ['playlist-2']);
	assert.deepEqual(state.rows.playlistItems.map((row) => row._id), ['item-3']);
	assert.equal(state.ended, true);
});

test('transaction failure rolls back all database deletions', async () => {
	const state = fixture({ failSessions: true });
	const before = structuredClone(state.rows);
	const snapshot = await state.repository.findUserDeletionSnapshot('target-1');
	await assert.rejects(state.repository.deleteUserCascade(snapshot), /session deletion failed/);
	assert.deepEqual(state.rows, before);
	assert.equal(state.ended, true);
});

test('changed media metadata prevents deletion of a newer file outside the snapshot', async () => {
	const state = fixture();
	const snapshot = await state.repository.findUserDeletionSnapshot('target-1');
	state.rows.playlists[0].image.storageKey = 'new-image';
	await assert.rejects(state.repository.deleteUserCascade(snapshot), UserDeletionChangedError);
	assert.equal(state.rows.users.length, 3);
	assert.deepEqual(state.operations, []);
});

test('missing target user causes no other deletion', async () => {
	const state = fixture();
	assert.equal(await state.repository.findUserDeletionSnapshot('missing-1'), null);
	const snapshot = await state.repository.findUserDeletionSnapshot('target-1');
	state.rows.users.shift();
	assert.equal(await state.repository.deleteUserCascade(snapshot), false);
	assert.deepEqual(state.operations, []);
});

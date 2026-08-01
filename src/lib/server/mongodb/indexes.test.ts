import type { MongoCollections } from './collections';
import { describe, expect, it, vi } from 'vitest';
import {
	ensureMongoIndexes,
	MONGODB_INDEX_DEFINITIONS
} from './indexes';

describe('MongoDB index definitions', () => {
	it('defines stable unique, lookup, listing, and filter indexes', () => {
		expect(MONGODB_INDEX_DEFINITIONS.users).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: 'users_username_unique',
					key: { username: 1 },
					unique: true
				}),
				expect.objectContaining({
					name: 'users_email_unique',
					key: { email: 1 },
					unique: true
				})
			])
		);
		expect(MONGODB_INDEX_DEFINITIONS.tracks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: 'tracks_public_id_unique',
					key: { publicId: 1 },
					unique: true
				}),
				expect.objectContaining({
					name: 'tracks_storage_key_unique',
					key: { storageKey: 1 },
					unique: true
				}),
				expect.objectContaining({
					name: 'tracks_owner_created_at_idx',
					key: { ownerId: 1, createdAt: -1, publicId: -1 }
				}),
				expect.objectContaining({
					name: 'tracks_public_created_at_idx',
					key: { visibility: 1, createdAt: -1, publicId: -1 }
				})
			])
		);
		expect(MONGODB_INDEX_DEFINITIONS.playlists).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: 'playlists_public_id_unique', key: { publicId: 1 }, unique: true }),
				expect.objectContaining({ name: 'playlists_owner_updated_at_idx', key: { ownerId: 1, updatedAt: -1, publicId: 1 } }),
				expect.objectContaining({ name: 'playlists_owner_public_id_idx', key: { ownerId: 1, publicId: 1 } })
			])
		);
		expect(MONGODB_INDEX_DEFINITIONS.playlistItems).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: 'playlist_items_playlist_track_unique', key: { playlistId: 1, trackId: 1 }, unique: true }),
				expect.objectContaining({ name: 'playlist_items_playlist_added_at_idx', key: { playlistId: 1, addedAt: 1, _id: 1 } }),
				expect.objectContaining({ name: 'playlist_items_track_id_idx', key: { trackId: 1 } })
			])
		);

		for (const field of ['bpm', 'musicalKey', 'genre']) {
			expect(
				MONGODB_INDEX_DEFINITIONS.tracks.some((index) =>
					Object.hasOwn(index.key, field)
				)
			).toBe(true);
		}
	});

	it('configures session expiration as a Date-field TTL index', () => {
		expect(MONGODB_INDEX_DEFINITIONS.sessions).toContainEqual({
			name: 'sessions_expires_at_ttl',
			key: { expiresAt: 1 },
			expireAfterSeconds: 0
		});
	});

	it('ensures indexes idempotently without defining a redundant counter index', async () => {
		const users = vi.fn().mockResolvedValue(['users_username_unique']);
		const sessions = vi.fn().mockResolvedValue(['sessions_expires_at_ttl']);
		const tracks = vi.fn().mockResolvedValue(['tracks_public_id_unique']);
		const playlists = vi.fn().mockResolvedValue(['playlists_public_id_unique']);
		const playlistItems = vi.fn().mockResolvedValue(['playlist_items_track_id_idx']);
		const collections = {
			users: { createIndexes: users },
			sessions: { createIndexes: sessions },
			tracks: { createIndexes: tracks },
			playlists: { createIndexes: playlists },
			playlistItems: { createIndexes: playlistItems },
			counters: { createIndexes: vi.fn() }
		} as unknown as MongoCollections;

		await expect(
			ensureMongoIndexes(collections, { maxTimeMS: 5_000 })
		).resolves.toEqual({
			users: ['users_username_unique'],
			sessions: ['sessions_expires_at_ttl'],
			tracks: ['tracks_public_id_unique'],
			playlists: ['playlists_public_id_unique'],
			playlistItems: ['playlist_items_track_id_idx'],
			counters: []
		});
		expect(collections.counters.createIndexes).not.toHaveBeenCalled();

		for (const createIndexes of [users, sessions, tracks, playlists, playlistItems]) {
			expect(createIndexes).toHaveBeenCalledWith(
				expect.any(Array),
				{ maxTimeMS: 5_000 }
			);
		}
	});
});

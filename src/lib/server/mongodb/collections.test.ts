import type { Db } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import {
	getMongoCollections,
	MONGODB_COLLECTION_NAMES
} from './collections';

describe('MongoDB collection mapping', () => {
	it('uses centralized names and typed accessors for every application collection', () => {
		const collection = vi.fn((name: string) => ({ collectionName: name }));
		const database = { collection } as unknown as Db;

		const collections = getMongoCollections(database);

		expect(MONGODB_COLLECTION_NAMES).toEqual({
			users: 'users',
			sessions: 'sessions',
			tracks: 'tracks',
			playlists: 'playlists',
			playlistItems: 'playlistItems',
			counters: 'counters',
			migrations: 'migrations'
		});
		expect(collection).toHaveBeenCalledTimes(7);
		expect(collections.users.collectionName).toBe('users');
		expect(collections.sessions.collectionName).toBe('sessions');
		expect(collections.tracks.collectionName).toBe('tracks');
		expect(collections.playlists.collectionName).toBe('playlists');
		expect(collections.playlistItems.collectionName).toBe('playlistItems');
		expect(collections.counters.collectionName).toBe('counters');
		expect(collections.migrations.collectionName).toBe('migrations');
	});
});

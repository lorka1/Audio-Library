import type { Db } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import {
	getMongoCollections,
	MONGODB_COLLECTION_NAMES
} from './collections';

describe('MongoDB collection mapping', () => {
	it('uses centralized names and typed accessors for every M1 collection', () => {
		const collection = vi.fn((name: string) => ({ collectionName: name }));
		const database = { collection } as unknown as Db;

		const collections = getMongoCollections(database);

		expect(MONGODB_COLLECTION_NAMES).toEqual({
			users: 'users',
			sessions: 'sessions',
			tracks: 'tracks',
			counters: 'counters'
		});
		expect(collection).toHaveBeenCalledTimes(4);
		expect(collections.users.collectionName).toBe('users');
		expect(collections.sessions.collectionName).toBe('sessions');
		expect(collections.tracks.collectionName).toBe('tracks');
		expect(collections.counters.collectionName).toBe('counters');
	});
});

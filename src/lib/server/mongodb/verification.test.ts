import type { Db, MongoClient } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import { MONGODB_INDEX_DEFINITIONS } from './indexes';
import {
	isRequiredMongoIndexCompatible,
	isMongoCounterCompatible,
	verifyMongoIndexes,
	verifyMongoOperationalState
} from './verification';

describe('required MongoDB index compatibility', () => {
	const expected = MONGODB_INDEX_DEFINITIONS.users[0];

	it('accepts the exact name, key and options', () => {
		expect(isRequiredMongoIndexCompatible({
			v: 2,
			name: expected.name,
			key: { username: 1 },
			unique: true
		}, expected)).toBe(true);
	});

	it('rejects key, uniqueness, sparse and partial-filter mismatches', () => {
		expect(isRequiredMongoIndexCompatible({
			v: 2,
			name: expected.name,
			key: { username: -1 },
			unique: true
		}, expected)).toBe(false);
		expect(isRequiredMongoIndexCompatible({
			v: 2,
			name: expected.name,
			key: { username: 1 },
			unique: false
		}, expected)).toBe(false);
		expect(isRequiredMongoIndexCompatible({
			v: 2,
			name: expected.name,
			key: { username: 1 },
			unique: true,
			sparse: true
		}, expected)).toBe(false);
	});
});

describe('MongoDB counter compatibility', () => {
	it('accepts a non-negative safe counter at or above the maximum public ID', () => {
		expect(isMongoCounterCompatible(3, 3)).toBe(true);
		expect(isMongoCounterCompatible(4, 3)).toBe(true);
	});

	it.each([
		[-1, 0],
		[2, 3],
		[1.5, 1],
		[Number.MAX_SAFE_INTEGER + 1, 1],
		['3', 3],
		[3, -1]
	])('rejects invalid counter state %s / %s', (value, maximum) => {
		expect(isMongoCounterCompatible(value, maximum)).toBe(false);
	});
});

describe('MongoDB topology failure paths', () => {
	function clientForHello(result: unknown): MongoClient {
		return {
			db: vi.fn(() => ({
				command: vi.fn().mockImplementation(() =>
					result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
				)
			}))
		} as unknown as MongoClient;
	}

	it('rejects an unavailable MongoDB deployment', async () => {
		await expect(verifyMongoOperationalState(
			clientForHello(new Error('synthetic unavailable')),
			{} as Db
		)).rejects.toThrow('synthetic unavailable');
	});

	it('rejects a replica set without a writable PRIMARY', async () => {
		await expect(verifyMongoOperationalState(
			clientForHello({ isWritablePrimary: false, setName: 'fixture' }),
			{} as Db
		)).rejects.toThrow('no writable PRIMARY');
	});

	it('rejects a standalone server without transaction support', async () => {
		await expect(verifyMongoOperationalState(
			clientForHello({ isWritablePrimary: true }),
			{} as Db
		)).rejects.toThrow('transaction support');
	});
});

describe('playlist index verification', () => {
	it('detects a missing required playlist-item index', async () => {
		const collection = vi.fn((name: string) => ({
			indexes: vi.fn().mockImplementation(() => Promise.resolve(
				(name in MONGODB_INDEX_DEFINITIONS
					? MONGODB_INDEX_DEFINITIONS[name as keyof typeof MONGODB_INDEX_DEFINITIONS]
					: [])
					.filter(({ name: indexName }) => indexName !== 'playlist_items_track_id_idx')
					.map((index) => ({ v: 2, ...index }))
			))
		}));
		await expect(verifyMongoIndexes({ collection } as unknown as Db)).rejects.toThrow(
			'playlist_items_track_id_idx'
		);
	});
});

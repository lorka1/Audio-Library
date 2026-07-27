import type { Db, MongoClient } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import { MONGODB_INDEX_DEFINITIONS } from './indexes';
import {
	isRequiredMongoIndexCompatible,
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

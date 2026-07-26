import type { MongoClient } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import {
	MongoClientManager,
	type MongoClientFactory
} from './client';
import type { MongoConfig } from './config';

const config: MongoConfig = {
	uri: 'mongodb://fixture-host.example.invalid:27017',
	databaseName: 'audio_library_dev',
	testDatabaseName: 'audio_library_test_unit',
	serverSelectionTimeoutMs: 8_000
};

function fakeClient(connect: () => Promise<unknown>) {
	return {
		connect: vi.fn(connect),
		close: vi.fn().mockResolvedValue(undefined),
		db: vi.fn()
	} as unknown as MongoClient;
}

describe('MongoClientManager', () => {
	it('caches one client and one in-flight connection attempt', async () => {
		let resolveConnection: (() => void) | undefined;
		const connected = new Promise<void>((resolve) => {
			resolveConnection = resolve;
		});
		const client = fakeClient(async () => {
			await connected;
			return client;
		});
		const factory = vi.fn(() => client) as MongoClientFactory;
		const manager = new MongoClientManager(config, factory);

		const first = manager.connect();
		const second = manager.connect();

		expect(first).toBe(second);
		expect(factory).toHaveBeenCalledTimes(1);
		expect(client.connect).toHaveBeenCalledTimes(1);
		expect(factory).toHaveBeenCalledWith(
			config.uri,
			expect.objectContaining({
				serverSelectionTimeoutMS: 8_000,
				connectTimeoutMS: 8_000,
				socketTimeoutMS: 8_000
			})
		);

		resolveConnection?.();
		await expect(first).resolves.toBe(client);
		await expect(second).resolves.toBe(client);
		await manager.close(true);
		expect(client.close).toHaveBeenCalledWith(true);
	});

	it('clears failed state so a later connection can recover', async () => {
		const failedClient = fakeClient(async () => {
			throw new Error('synthetic connection failure');
		});
		const recoveredClient = fakeClient(async () => recoveredClient);
		const factory = vi
			.fn()
			.mockReturnValueOnce(failedClient)
			.mockReturnValueOnce(recoveredClient) as MongoClientFactory;
		const manager = new MongoClientManager(config, factory);

		await expect(manager.connect()).rejects.toThrow(
			'synthetic connection failure'
		);
		expect(failedClient.close).toHaveBeenCalledWith(true);
		await expect(manager.connect()).resolves.toBe(recoveredClient);
		expect(factory).toHaveBeenCalledTimes(2);

		await manager.close(true);
		expect(recoveredClient.close).toHaveBeenCalledWith(true);
	});
});

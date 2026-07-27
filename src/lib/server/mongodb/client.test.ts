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
	serverSelectionTimeoutMs: 8_000,
	connectTimeoutMs: 8_000,
	socketTimeoutMs: 15_000
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
				socketTimeoutMS: 15_000
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

	it('closes an owned client exactly once across repeated shutdown calls', async () => {
		const client = fakeClient(async () => client);
		const manager = new MongoClientManager(config, () => client);
		await manager.connect();
		await Promise.all([manager.close(true), manager.close(true), manager.close(true)]);
		expect(client.close).toHaveBeenCalledOnce();
	});

	it('preserves connection failure and reports close failure separately', async () => {
		const client = fakeClient(async () => {
			throw new Error('primary connection failure');
		});
		vi.mocked(client.close).mockRejectedValue(new Error('cleanup failure'));
		const reportCleanup = vi.fn();
		const manager = new MongoClientManager(config, () => client, reportCleanup);
		await expect(manager.connect()).rejects.toThrow('primary connection failure');
		expect(reportCleanup).toHaveBeenCalledOnce();
	});
});

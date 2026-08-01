import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	connectMongoDevelopment: vi.fn(),
	getMongoCollections: vi.fn(),
	createMongoTrackRepository: vi.fn()
}));

vi.mock('../mongodb/client', () => ({
	connectMongoDevelopment: mocks.connectMongoDevelopment
}));
vi.mock('../mongodb/collections', () => ({
	getMongoCollections: mocks.getMongoCollections
}));
vi.mock('./mongodb-repository', () => ({
	createMongoTrackRepository: mocks.createMongoTrackRepository
}));

import {
	getApplicationTrackRepository,
	getFocusedMongoTrackRepository
} from './persistence';

describe('MongoDB track persistence', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('constructs the application repository from centralized MongoDB collections', async () => {
		const database = {};
		const client = {};
		const collections = { tracks: {}, counters: {}, users: {}, playlistItems: {} };
		const repository = {};
		mocks.connectMongoDevelopment.mockResolvedValue({ client, database });
		mocks.getMongoCollections.mockReturnValue(collections);
		mocks.createMongoTrackRepository.mockReturnValue(repository);

		await expect(getApplicationTrackRepository()).resolves.toBe(repository);
		expect(mocks.getMongoCollections).toHaveBeenCalledWith(database);
		expect(mocks.createMongoTrackRepository).toHaveBeenCalledWith(
			collections.tracks,
			collections.counters,
			collections.users,
			{ client, playlistItems: collections.playlistItems }
		);
	});

	it('uses the same MongoDB construction for focused verification', async () => {
		const collections = { tracks: {}, counters: {}, users: {}, playlistItems: {} };
		const repository = {};
		mocks.connectMongoDevelopment.mockResolvedValue({
			client: {},
			database: {}
		});
		mocks.getMongoCollections.mockReturnValue(collections);
		mocks.createMongoTrackRepository.mockReturnValue(repository);

		await expect(getFocusedMongoTrackRepository()).resolves.toBe(repository);
	});
});

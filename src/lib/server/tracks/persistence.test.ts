import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	sqliteTrackRepository: { backend: 'sqlite-track-repository' },
	connectMongoDevelopment: vi.fn(),
	getMongoCollections: vi.fn(),
	createMongoTrackRepository: vi.fn()
}));

vi.mock('./sqlite-repository', () => ({
	sqliteTrackRepository: mocks.sqliteTrackRepository
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

describe('M5 track persistence selection', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('keeps SQLite as the default complete application track backend', async () => {
		await expect(
			getApplicationTrackRepository({ DATABASE_BACKEND: 'sqlite' })
		).resolves.toBe(mocks.sqliteTrackRepository);
		await expect(
			getApplicationTrackRepository({ DATABASE_BACKEND: '' })
		).resolves.toBe(mocks.sqliteTrackRepository);
	});

	it('selects the complete MongoDB track backend', async () => {
		const database = {};
		const collections = {
			tracks: {},
			counters: {},
			users: {}
		};
		const repository = {};
		mocks.connectMongoDevelopment.mockResolvedValue({
			client: {},
			database
		});
		mocks.getMongoCollections.mockReturnValue(collections);
		mocks.createMongoTrackRepository.mockReturnValue(repository);

		await expect(
			getApplicationTrackRepository({ DATABASE_BACKEND: 'mongodb' })
		).resolves.toBe(repository);
		expect(mocks.createMongoTrackRepository).toHaveBeenCalledWith(
			collections.tracks,
			collections.counters,
			collections.users
		);
	});

	it('constructs focused MongoDB verification without changing the selector', async () => {
		const collections = { tracks: {}, counters: {}, users: {} };
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

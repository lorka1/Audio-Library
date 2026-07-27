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
	assertM4ApplicationPersistenceReady,
	getApplicationTrackRepository,
	getFocusedMongoTrackRepository,
	M4_MONGODB_TRACK_CUTOVER_GUARD_MESSAGE
} from './persistence';

describe('M4 track persistence selection', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('keeps SQLite as the complete application track backend', () => {
		expect(
			getApplicationTrackRepository({ DATABASE_BACKEND: 'sqlite' })
		).toBe(mocks.sqliteTrackRepository);
		expect(
			getApplicationTrackRepository({ DATABASE_BACKEND: '' })
		).toBe(mocks.sqliteTrackRepository);
	});

	it('guards an incomplete MongoDB application route cutover', () => {
		expect(() =>
			assertM4ApplicationPersistenceReady({
				DATABASE_BACKEND: 'mongodb'
			})
		).toThrowError(M4_MONGODB_TRACK_CUTOVER_GUARD_MESSAGE);
	});

	it('constructs MongoDB tracks only through the focused repository factory', async () => {
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

		await expect(getFocusedMongoTrackRepository()).resolves.toBe(repository);
		expect(mocks.createMongoTrackRepository).toHaveBeenCalledWith(
			collections.tracks,
			collections.counters,
			collections.users
		);
	});
});

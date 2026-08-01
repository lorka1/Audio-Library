import type { Collection, MongoClient } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import type {
	CounterDocument,
	PlaylistItemDocument,
	TrackDocument,
	UserDocument
} from '../mongodb/documents';
import { createMongoTrackRepository } from './mongodb-repository';

const ownerId = '11111111-1111-4111-8111-111111111111';
const internalTrackId = '22222222-2222-4222-8222-222222222222';

function harness(options: { track?: unknown; cleanupError?: Error } = {}) {
	const session = {
		withTransaction: vi.fn(async (work: () => Promise<void>) => work()),
		endSession: vi.fn().mockResolvedValue(undefined)
	};
	const client = { startSession: vi.fn(() => session) } as unknown as MongoClient;
	const tracks = {
		findOne: vi.fn().mockResolvedValue(
			options.track === undefined ? { _id: internalTrackId } : options.track
		),
		deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 })
	} as unknown as Collection<TrackDocument>;
	const playlistItems = {
		deleteMany: options.cleanupError
			? vi.fn().mockRejectedValue(options.cleanupError)
			: vi.fn().mockResolvedValue({ deletedCount: 2 })
	} as unknown as Collection<PlaylistItemDocument>;
	const repository = createMongoTrackRepository(
		tracks,
		{} as Collection<CounterDocument>,
		{} as Collection<UserDocument>,
		{ client, playlistItems }
	);
	return { repository, tracks, playlistItems, session };
}

describe('transactional track playlist cleanup', () => {
	it('deletes only memberships for the exact internal track in the track transaction', async () => {
		const { repository, tracks, playlistItems, session } = harness();
		await expect(repository.deleteOwnerTrack(21, ownerId)).resolves.toBe(true);
		expect(tracks.deleteOne).toHaveBeenCalledWith(
			{ _id: internalTrackId, ownerId },
			expect.objectContaining({ session })
		);
		expect(playlistItems.deleteMany).toHaveBeenCalledWith(
			{ trackId: internalTrackId },
			expect.objectContaining({ session })
		);
		expect(session.endSession).toHaveBeenCalledOnce();
	});

	it('propagates playlist cleanup failure so MongoDB can roll back track deletion', async () => {
		const primary = new Error('synthetic playlist cleanup failure');
		const { repository, session } = harness({ cleanupError: primary });
		await expect(repository.deleteOwnerTrack(21, ownerId)).rejects.toBe(primary);
		expect(session.endSession).toHaveBeenCalledOnce();
	});

	it('does not touch playlist items when the owner-scoped track is absent', async () => {
		const { repository, playlistItems, session } = harness({ track: null });
		await expect(repository.deleteOwnerTrack(21, ownerId)).resolves.toBe(false);
		expect(playlistItems.deleteMany).not.toHaveBeenCalled();
		expect(session.endSession).toHaveBeenCalledOnce();
	});
});

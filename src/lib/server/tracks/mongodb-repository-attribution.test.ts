import type { Collection } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import type { CounterDocument, TrackDocument, UserDocument } from '../mongodb/documents';
import { createMongoTrackRepository } from './mongodb-repository';

const now = new Date('2026-08-03T12:00:00.000Z');

function repositoryWith(records: unknown[]) {
	const aggregate = vi.fn((pipeline: Record<string, unknown>[]) => ({
		toArray: vi.fn().mockResolvedValue(records)
	}));
	const tracks = {
		aggregate
	} as unknown as Collection<TrackDocument>;
	const counters = {} as Collection<CounterDocument>;
	const users = { collectionName: 'users' } as Collection<UserDocument>;
	return {
		repository: createMongoTrackRepository(tracks, counters, users),
		aggregate
	};
}

describe('MongoDB uploader attribution queries', () => {
	it('loads a public result set with one owner lookup and no per-track user query', async () => {
		const { repository, aggregate } = repositoryWith([{
			publicId: 21,
			title: 'Synthetic track',
			artist: 'safe_uploader',
			ownerUsername: 'safe_uploader',
			coverImage: null,
			bpm: null,
			musicalKey: null,
			genre: null,
			description: null,
			fileSizeBytes: 64,
			createdAt: now,
			updatedAt: now
		}]);

		await expect(repository.listPublicTracks({ sort: 'newest' })).resolves.toEqual([
			expect.objectContaining({ artist: 'safe_uploader', ownerUsername: 'safe_uploader' })
		]);
		expect(aggregate).toHaveBeenCalledOnce();
		const pipeline = vi.mocked(aggregate).mock.calls[0]![0];
		expect(pipeline.some((stage) => '$lookup' in stage)).toBe(true);
		expect(JSON.stringify(pipeline)).toContain('Unknown uploader');
	});

	it('loads an owner track list with one aggregate rather than an N+1 lookup', async () => {
		const { repository, aggregate } = repositoryWith([{
			publicId: 22,
			title: 'Owner track',
			artist: 'owner_account',
			coverImage: null,
			bpm: null,
			musicalKey: null,
			genre: null,
			description: null,
			visibility: 'private',
			fileSizeBytes: 64,
			mimeType: 'audio/mpeg',
			originalFilename: 'fixture.mp3',
			createdAt: now,
			updatedAt: now
		}]);

		await expect(repository.listTracksForOwner('owner-id')).resolves.toEqual([
			expect.objectContaining({ artist: 'owner_account' })
		]);
		expect(aggregate).toHaveBeenCalledOnce();
	});
});

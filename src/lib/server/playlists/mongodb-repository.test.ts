import { MongoServerError, type Collection, type MongoClient } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import type {
	PlaylistDocument,
	PlaylistItemDocument,
	TrackDocument,
	UserDocument
} from '../mongodb/documents';
import { createMongoPlaylistRepository } from './mongodb-repository';

const ownerId = '11111111-1111-4111-8111-111111111111';
const publicId = 'abcdefghijklmnopqrstuvwx';
const playlistId = '22222222-2222-4222-8222-222222222222';
const trackId = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-07-30T12:00:00.000Z');

function harness(overrides: {
	playlist?: unknown;
	track?: unknown;
	insertError?: unknown;
	itemRecords?: unknown[];
	endError?: unknown;
} = {}) {
	const endSession = overrides.endError
		? vi.fn().mockRejectedValue(overrides.endError)
		: vi.fn().mockResolvedValue(undefined);
	const session = {
		withTransaction: vi.fn(async (work: () => Promise<void>) => work()),
		endSession
	};
	const client = { startSession: vi.fn(() => session) } as unknown as MongoClient;
	const playlists = {
		collectionName: 'playlists',
		findOne: vi.fn().mockResolvedValue(overrides.playlist === undefined ? { _id: playlistId } : overrides.playlist),
		insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
		updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
		deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
		findOneAndUpdate: vi.fn(),
		aggregate: vi.fn()
	} as unknown as Collection<PlaylistDocument>;
	const playlistItems = {
		collectionName: 'playlistItems',
		findOne: vi.fn().mockResolvedValue(null),
		insertOne: overrides.insertError
			? vi.fn().mockRejectedValue(overrides.insertError)
			: vi.fn().mockResolvedValue({ acknowledged: true }),
		deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
		deleteMany: vi.fn().mockResolvedValue({ deletedCount: 2 }),
		countDocuments: vi.fn().mockResolvedValue(0),
		find: vi.fn(),
		aggregate: vi.fn(() => ({
			toArray: vi.fn().mockResolvedValue(overrides.itemRecords ?? [])
		}))
	} as unknown as Collection<PlaylistItemDocument>;
	const tracks = {
		collectionName: 'tracks',
		findOne: vi.fn().mockResolvedValue(overrides.track === undefined ? { _id: trackId } : overrides.track),
		find: vi.fn()
	} as unknown as Collection<TrackDocument>;
	const users = { collectionName: 'users' } as Collection<UserDocument>;
	const repository = createMongoPlaylistRepository(
		client,
		playlists,
		playlistItems,
		tracks,
		users,
		{
			now: () => now,
			createInternalId: () => '44444444-4444-4444-8444-444444444444',
			createPublicId: () => publicId
		}
	);
	return { repository, client, session, playlists, playlistItems, tracks, users, endSession };
}

describe('MongoDB playlist repository transactions', () => {
	it('adds an accessible track and updates the playlist atomically', async () => {
		const { repository, session, playlists, playlistItems, tracks, endSession } = harness();
		await expect(repository.addTrackToPlaylist(ownerId, publicId, 21)).resolves.toBe('added');
		expect(playlists.findOne).toHaveBeenCalledWith(
			{ ownerId, publicId },
			expect.objectContaining({ session })
		);
		expect(tracks.findOne).toHaveBeenCalledWith(
			{ publicId: 21, $or: [{ visibility: 'public' }, { ownerId }] },
			expect.objectContaining({ session })
		);
		expect(playlistItems.insertOne).toHaveBeenCalledWith(
			expect.objectContaining({ playlistId, trackId }),
			expect.objectContaining({ session })
		);
		expect(playlists.updateOne).toHaveBeenCalledWith(
			{ _id: playlistId, ownerId },
			{ $set: { updatedAt: now } },
			expect.objectContaining({ session })
		);
		expect(endSession).toHaveBeenCalledOnce();
	});

	it('keeps duplicate add idempotent and does not change updatedAt', async () => {
		const { repository, playlists, playlistItems, endSession } = harness();
		vi.mocked(playlistItems.findOne).mockResolvedValue({
			_id: '55555555-5555-4555-8555-555555555555',
			playlistId,
			trackId,
			addedAt: now
		});
		await expect(repository.addTrackToPlaylist(ownerId, publicId, 21)).resolves.toBe('already-added');
		expect(playlistItems.insertOne).not.toHaveBeenCalled();
		expect(playlists.updateOne).not.toHaveBeenCalled();
		expect(endSession).toHaveBeenCalledOnce();
	});

	it('does not query a track or reveal whether it exists when the playlist is non-owned', async () => {
		const { repository, tracks } = harness({ playlist: null });
		await expect(repository.addTrackToPlaylist(ownerId, publicId, 21)).resolves.toBe('not-found');
		expect(tracks.findOne).not.toHaveBeenCalled();
	});

	it('deletes playlist items and the owner-scoped playlist in one session', async () => {
		const { repository, playlistItems, playlists, session, endSession } = harness();
		await expect(repository.deletePlaylistForOwner(ownerId, publicId)).resolves.toBe(true);
		expect(playlistItems.deleteMany).toHaveBeenCalledWith(
			{ playlistId },
			expect.objectContaining({ session })
		);
		expect(playlists.deleteOne).toHaveBeenCalledWith(
			{ _id: playlistId, ownerId },
			expect.objectContaining({ session })
		);
		expect(endSession).toHaveBeenCalledOnce();
	});

	it('preserves the primary transaction error when session cleanup also fails', async () => {
		const primary = new Error('synthetic primary failure');
		const { repository, endSession } = harness({ insertError: primary, endError: new Error('synthetic cleanup failure') });
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		await expect(repository.addTrackToPlaylist(ownerId, publicId, 21)).rejects.toBe(primary);
		expect(endSession).toHaveBeenCalledOnce();
		log.mockRestore();
	});
});

describe('MongoDB playlist repository safe detail projection', () => {
	it('omits missing and newly inaccessible tracks without exposing internal IDs', async () => {
		const items = [
			{
				addedAt: now,
				track: {
					publicId: 21,
					ownerId: 'another-owner',
					title: 'Synthetic public track',
					artist: 'Synthetic artist',
					coverImage: { storageKey: 'private-cover.webp', mimeType: 'image/webp', byteSize: 64 },
					bpm: null,
					musicalKey: null,
					genre: null,
					description: null,
					visibility: 'public'
				}
			},
			{
				addedAt: now,
				track: {
					publicId: 22,
					ownerId: 'another-owner',
					title: 'Hidden private track',
					artist: 'Hidden artist',
					coverImage: null,
					bpm: null,
					musicalKey: null,
					genre: null,
					description: null,
					visibility: 'private'
				}
			},
			{ addedAt: now }
		];
		const { repository, playlists } = harness({ itemRecords: items });
		vi.mocked(playlists.findOne).mockResolvedValue({
			_id: playlistId,
			publicId,
			ownerId,
			name: 'Synthetic playlist',
			description: null,
			createdAt: now,
			updatedAt: now
		});
		const result = await repository.findPlaylistForOwner(ownerId, publicId);
		expect(result?.tracks).toHaveLength(1);
		expect(result?.unavailableTrackCount).toBe(2);
		const serialized = JSON.stringify(result);
		for (const secret of [playlistId, ownerId, 'another-owner', 'private-cover.webp', 'Hidden private track']) {
			expect(serialized).not.toContain(secret);
		}
		expect(serialized).toContain('/api/tracks/21/cover');
	});
});

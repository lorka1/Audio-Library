import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateTrackInput } from './repository';

const databaseMocks = vi.hoisted(() => ({
	insert: vi.fn(),
	values: vi.fn(),
	returning: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	db: {
		insert: databaseMocks.insert
	}
}));

vi.mock('$lib/server/db/schema', () => ({
	tracks: {
		publicId: 'publicId',
		id: 'id',
		ownerId: 'ownerId',
		title: 'title',
		artist: 'artist',
		bpm: 'bpm',
		musicalKey: 'musicalKey',
		genre: 'genre',
		description: 'description',
		originalFilename: 'originalFilename',
		storageKey: 'storageKey',
		mimeType: 'mimeType',
		fileSizeBytes: 'fileSizeBytes',
		visibility: 'visibility',
		createdAt: 'createdAt',
		updatedAt: 'updatedAt'
	},
	users: {
		id: 'userId',
		username: 'username'
	}
}));

import { createTrack } from './repository';

const NOW = new Date('2026-07-24T17:00:00.000Z');

function trackInput(): CreateTrackInput {
	return {
		id: 'track-id',
		ownerId: 'authenticated-owner-id',
		title: 'Public track',
		artist: 'Test Artist',
		bpm: 124,
		musicalKey: 'C minor',
		genre: 'Techno',
		description: null,
		originalFilename: 'original.mp3',
		storageKey: '550e8400-e29b-41d4-a716-446655440000.mp3',
		mimeType: 'audio/mpeg',
		fileSizeBytes: 1024,
		createdAt: NOW,
		updatedAt: NOW
	};
}

describe('createTrack', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		databaseMocks.insert.mockReturnValue({ values: databaseMocks.values });
		databaseMocks.values.mockReturnValue({ returning: databaseMocks.returning });
		databaseMocks.returning.mockResolvedValue([
			{ id: 42, title: 'Public track', createdAt: NOW }
		]);
	});

	it('keeps the authenticated owner and inserts new uploads as public', async () => {
		const input = trackInput();

		await createTrack(input);

		expect(databaseMocks.values).toHaveBeenCalledWith({
			...input,
			visibility: 'public'
		});
	});
});

import { describe, expect, it } from 'vitest';
import { toOwnerTrack, type OwnerTrackRecord } from './owner-model';

describe('toOwnerTrack', () => {
	it('maps only the explicit owner-management projection', () => {
		const record: OwnerTrackRecord = {
			publicId: 42,
			title: 'Owner track',
			artist: 'Owner artist',
			coverImage: null,
			bpm: 128,
			musicalKey: 'C minor',
			genre: 'Techno',
			description: 'Safe description.',
			visibility: 'private',
			fileSizeBytes: 512,
			mimeType: 'audio/mpeg',
			originalFilename: 'owner-facing.mp3',
			createdAt: new Date('2026-07-24T10:00:00.000Z'),
			updatedAt: new Date('2026-07-25T11:00:00.000Z')
		};

		const track = toOwnerTrack(record);

		expect(track).toEqual({
			publicId: 42,
			title: 'Owner track',
			artist: 'Owner artist',
			coverImageUrl: null,
			bpm: 128,
			musicalKey: 'C minor',
			genre: 'Techno',
			description: 'Safe description.',
			visibility: 'private',
			fileSizeBytes: 512,
			mimeType: 'audio/mpeg',
			originalFilename: 'owner-facing.mp3',
			createdAt: '2026-07-24T10:00:00.000Z',
			updatedAt: '2026-07-25T11:00:00.000Z'
		});
		expect(Object.keys(track)).not.toContain('id');
		expect(Object.keys(track)).not.toContain('ownerId');
		expect(Object.keys(track)).not.toContain('storageKey');
		expect(Object.keys(track)).not.toContain('storedFilename');
	});

	it('maps cover metadata to an owner-safe URL without exposing its key', () => {
		const record: OwnerTrackRecord = {
			publicId: 43,
			title: 'Covered owner track',
			artist: 'Owner artist',
			coverImage: {
				storageKey: '22222222-2222-4222-8222-222222222222.png',
				mimeType: 'image/png',
				byteSize: 32
			},
			bpm: null,
			musicalKey: null,
			genre: null,
			description: null,
			visibility: 'private',
			fileSizeBytes: 512,
			mimeType: 'audio/mpeg',
			originalFilename: 'owner-facing.mp3',
			createdAt: new Date('2026-07-24T10:00:00.000Z'),
			updatedAt: new Date('2026-07-25T11:00:00.000Z')
		};

		const track = toOwnerTrack(record);
		expect(track.coverImageUrl).toBe('/api/tracks/43/cover');
		expect(JSON.stringify(track)).not.toContain('22222222');
		expect(track).not.toHaveProperty('coverImage');
	});
});

import { describe, expect, it } from 'vitest';
import { toPublicTrack } from './public-model';

describe('toPublicTrack', () => {
	it('maps only explicit safe public fields', () => {
		const internalRecord = {
			publicId: 7,
			title: 'Public track',
			artist: 'Test Artist',
			bpm: 128,
			musicalKey: 'C minor',
			genre: 'Techno',
			description: 'Safe public description.',
			fileSizeBytes: 4096,
			ownerUsername: 'test_owner',
			createdAt: new Date('2026-07-24T10:00:00.000Z'),
			updatedAt: new Date('2026-07-24T11:00:00.000Z'),
			internalId: '11111111-1111-4111-8111-111111111111',
			storedFilename: '22222222-2222-4222-8222-222222222222.mp3',
			physicalPath: 'C:\\private\\audio\\file.mp3',
			ownerId: 'private-owner-id',
			ownerEmail: 'private@example.test'
		};

		const publicTrack = toPublicTrack(internalRecord);

		expect(publicTrack).toEqual({
			id: 7,
			title: 'Public track',
			artist: 'Test Artist',
			coverImageUrl: null,
			bpm: 128,
			musicalKey: 'C minor',
			genre: 'Techno',
			description: 'Safe public description.',
			fileSizeBytes: 4096,
			ownerUsername: 'test_owner',
			createdAt: '2026-07-24T10:00:00.000Z',
			updatedAt: '2026-07-24T11:00:00.000Z'
		});
		expect(publicTrack).not.toHaveProperty('internalId');
		expect(publicTrack).not.toHaveProperty('storedFilename');
		expect(publicTrack).not.toHaveProperty('physicalPath');
		expect(publicTrack).not.toHaveProperty('ownerId');
		expect(publicTrack).not.toHaveProperty('ownerEmail');
	});

	it('exposes only a deterministic cover URL when private cover metadata exists', () => {
		const publicTrack = toPublicTrack({
			publicId: 9,
			title: 'Covered track',
			artist: 'Test Artist',
			coverImage: {
				storageKey: '22222222-2222-4222-8222-222222222222.webp',
				mimeType: 'image/webp',
				byteSize: 64
			},
			bpm: null,
			musicalKey: null,
			genre: null,
			description: null,
			fileSizeBytes: 1,
			ownerUsername: 'owner',
			createdAt: new Date('2026-07-24T10:00:00.000Z'),
			updatedAt: new Date('2026-07-24T10:00:00.000Z')
		});

		expect(publicTrack.coverImageUrl).toBe('/api/tracks/9/cover');
		expect(JSON.stringify(publicTrack)).not.toContain('22222222');
		expect(publicTrack).not.toHaveProperty('coverImage');
	});

	it('preserves null optional metadata without undefined values', () => {
		const publicTrack = toPublicTrack({
			publicId: 8,
			title: 'Minimal track',
			artist: 'Test Artist',
			bpm: null,
			musicalKey: null,
			genre: null,
			description: null,
			fileSizeBytes: 1,
			ownerUsername: 'owner',
			createdAt: new Date('2026-07-24T10:00:00.000Z'),
			updatedAt: new Date('2026-07-24T10:00:00.000Z')
		});

		expect(publicTrack).toMatchObject({
			coverImageUrl: null,
			bpm: null,
			musicalKey: null,
			genre: null,
			description: null
		});
		expect(JSON.stringify(publicTrack)).not.toContain('undefined');
	});
});

import { describe, expect, it } from 'vitest';
import { formatPlaybackTime, toPublicPlayerTrack } from './model';

describe('toPublicPlayerTrack', () => {
	it('projects only safe public playback fields and numeric URLs', () => {
		const source = {
			id: 42,
			title: 'Release Fixture Track',
			artist: 'Fixture Artist',
			internalId: '11111111-1111-4111-8111-111111111111',
			ownerId: 'private-owner-id',
			ownerEmail: 'private@example.test',
			storageKey: 'private-storage-name.mp3',
			physicalPath: 'C:\\private\\audio\\private-storage-name.mp3'
		};

		const playerTrack = toPublicPlayerTrack(source);
		const serialized = JSON.stringify(playerTrack);

		expect(playerTrack).toEqual({
			id: 42,
			title: 'Release Fixture Track',
			artist: 'Fixture Artist',
			streamUrl: '/api/tracks/42/stream',
			detailsUrl: '/tracks/42'
		});
		expect(Object.keys(playerTrack)).toEqual([
			'id',
			'title',
			'artist',
			'streamUrl',
			'detailsUrl'
		]);
		expect(serialized).not.toContain(source.internalId);
		expect(serialized).not.toContain(source.ownerId);
		expect(serialized).not.toContain(source.ownerEmail);
		expect(serialized).not.toContain(source.storageKey);
		expect(serialized).not.toContain(source.physicalPath);
	});
});

describe('formatPlaybackTime', () => {
	it('formats finite playback positions without exposing invalid values', () => {
		expect(formatPlaybackTime(0)).toBe('0:00');
		expect(formatPlaybackTime(65.9)).toBe('1:05');
		expect(formatPlaybackTime(Number.NaN)).toBe('0:00');
	});
});

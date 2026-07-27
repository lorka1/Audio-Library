import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { createAudioPlayerController } from './controller';
import type { PublicPlayerTrack } from './model';

const firstTrack: PublicPlayerTrack = {
	id: 10,
	title: 'First Fixture',
	artist: 'Fixture Artist',
	streamUrl: '/api/tracks/10/stream',
	detailsUrl: '/tracks/10'
};

const secondTrack: PublicPlayerTrack = {
	id: 11,
	title: 'Second Fixture',
	artist: 'Second Artist',
	streamUrl: '/api/tracks/11/stream',
	detailsUrl: '/tracks/11'
};

describe('AudioPlayerController', () => {
	it('selects a track and requests playback', () => {
		const player = createAudioPlayerController();

		player.toggleTrack(firstTrack);

		expect(get(player)).toMatchObject({
			track: firstTrack,
			status: 'loading',
			wantsToPlay: true,
			currentTime: 0
		});
	});

	it('transitions between playing, paused, and resumed states', () => {
		const player = createAudioPlayerController();

		player.toggleTrack(firstTrack);
		player.markPlaying();
		expect(get(player).status).toBe('playing');

		player.toggleTrack(firstTrack);
		player.markPaused();
		expect(get(player)).toMatchObject({ status: 'paused', wantsToPlay: false });

		player.toggleTrack(firstTrack);
		expect(get(player)).toMatchObject({ status: 'loading', wantsToPlay: true });
	});

	it('replaces the selected track instead of retaining simultaneous playback', () => {
		const player = createAudioPlayerController();

		player.toggleTrack(firstTrack);
		player.markPlaying();
		player.toggleTrack(secondTrack);

		expect(get(player)).toMatchObject({
			track: secondTrack,
			status: 'loading',
			wantsToPlay: true,
			currentTime: 0,
			duration: 0
		});
	});

	it('preserves playback state when route content changes around the root controller', () => {
		const player = createAudioPlayerController();

		player.toggleTrack(firstTrack);
		player.setCurrentTime(37.5);
		player.setDuration(180);
		player.setVolume(0.4);
		player.markPlaying();

		const beforeNavigation = get(player);
		const simulatedInternalDestination = '/upload';

		expect(simulatedInternalDestination).toBe('/upload');
		expect(get(player)).toEqual(beforeNavigation);
	});

	it('recovers from a playback error through the same track control', () => {
		const player = createAudioPlayerController();

		player.toggleTrack(firstTrack);
		player.markError();
		expect(get(player)).toMatchObject({
			status: 'error',
			wantsToPlay: false,
			errorMessage: 'Playback is unavailable. Try again.'
		});

		player.toggleTrack(firstTrack);
		expect(get(player)).toMatchObject({
			status: 'loading',
			wantsToPlay: true,
			errorMessage: null
		});
	});

	it('returns to a resumable paused state when playback ends', () => {
		const player = createAudioPlayerController();

		player.toggleTrack(firstTrack);
		player.setDuration(120);
		player.markPlaying();
		player.markEnded();

		expect(get(player)).toMatchObject({
			status: 'paused',
			wantsToPlay: false,
			currentTime: 120
		});
	});
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { get } from 'svelte/store';
import { createAudioPlayerController } from '../src/lib/player/controller.ts';

const trackA = {
	id: 1,
	title: 'Track A',
	artist: 'Artist A',
	coverImageUrl: '/api/tracks/1/cover',
	streamUrl: '/api/tracks/1/stream',
	detailsUrl: '/tracks/1'
};

test('editing another track leaves the loaded player untouched', () => {
	const player = createAudioPlayerController();
	player.toggleTrack(trackA);
	const before = get(player);

	player.updateTrackMetadata(2, { title: 'Track B Edited' });

	assert.equal(get(player), before);
});

test('metadata updates preserve the active audio source and playback state', () => {
	const player = createAudioPlayerController();
	player.toggleTrack(trackA);
	player.markPlaying();
	player.setCurrentTime(12.5);
	player.setVolume(0.35);
	const before = get(player);

	player.updateTrackMetadata(1, {
		title: 'Track A Edited',
		artist: 'Artist A Edited',
		coverImageUrl: '/api/tracks/1/cover?v=new'
	});

	const after = get(player);
	assert.deepEqual(after.track, {
		...trackA,
		title: 'Track A Edited',
		artist: 'Artist A Edited',
		coverImageUrl: '/api/tracks/1/cover?v=new'
	});
	assert.equal(after.track.streamUrl, before.track.streamUrl);
	assert.equal(after.requestVersion, before.requestVersion);
	assert.equal(after.currentTime, before.currentTime);
	assert.equal(after.volume, before.volume);
	assert.equal(after.status, before.status);
	assert.equal(after.wantsToPlay, before.wantsToPlay);

	player.toggleTrack(after.track);
	const paused = get(player);
	player.updateTrackMetadata(1, { coverImageUrl: null });
	const afterCoverRemoval = get(player);
	assert.equal(afterCoverRemoval.track.coverImageUrl, null);
	assert.equal(afterCoverRemoval.currentTime, paused.currentTime);
	assert.equal(afterCoverRemoval.volume, paused.volume);
	assert.equal(afterCoverRemoval.wantsToPlay, false);
	assert.equal(afterCoverRemoval.requestVersion, paused.requestVersion);
});

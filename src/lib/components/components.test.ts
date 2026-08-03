import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { createAudioPlayerController } from '$lib/player/controller';
import type { PublicPlayerTrack } from '$lib/player/model';
import type { PublicTrack } from '$lib/types';
import GlobalAudioPlayer from './GlobalAudioPlayer.svelte';
import AddToPlaylist from './AddToPlaylist.svelte';
import CoverImageField from './CoverImageField.svelte';
import SiteHeader from './SiteHeader.svelte';
import TrackCard from './TrackCard.svelte';
import TrackCover from './TrackCover.svelte';
import TrackFilters from './TrackFilters.svelte';
import TrackPlayButton from './TrackPlayButton.svelte';

const playerTrack: PublicPlayerTrack = {
	id: 21,
	title: 'Release Fixture Track',
	artist: 'Fixture Artist',
	coverImageUrl: '/api/tracks/21/cover',
	streamUrl: '/api/tracks/21/stream',
	detailsUrl: '/tracks/21'
};

const publicTrack: PublicTrack = {
	id: 21,
	title: 'Release Fixture Track',
	artist: 'Fixture Artist',
	bpm: 124,
	musicalKey: 'A minor',
	genre: 'Electronic',
	description: 'Synthetic fixture.',
	coverImageUrl: '/api/tracks/21/cover',
	fileSizeBytes: 1024,
	ownerUsername: 'fixture_owner',
	createdAt: '2026-07-26T12:00:00.000Z',
	updatedAt: '2026-07-26T12:00:00.000Z'
};

describe('global playback components', () => {
	it('renders exactly one root-owned audio element', () => {
		const player = createAudioPlayerController();
		player.toggleTrack(playerTrack);
		const { body } = render(GlobalAudioPlayer, { props: { player } });

		expect(body.match(/<audio\b/g)).toHaveLength(1);
		expect(body).toContain('Release Fixture Track');
		expect(body).toContain('Fixture Artist');
		expect(body).toContain('href="/tracks/21"');
		expect(body).toContain('src="/api/tracks/21/cover"');
		expect(body).toContain('aria-label="Seek Release Fixture Track"');
		expect(body).toContain('aria-label="Volume"');
		expect(body).not.toContain('aria-label="Close audio player"');
	});

	it('renders a Browse Tracks play button without replacing the details link', () => {
		const player = createAudioPlayerController();
		const { body } = render(TrackCard, {
			props: { track: publicTrack, player }
		});

		expect(body).toContain('aria-label="Play Release Fixture Track"');
		expect(body).toContain('href="/tracks/21"');
		expect(body).toContain('src="/api/tracks/21/cover"');
		expect(body).not.toContain('<audio');
	});

	it('renders the local fallback cover when a track has no uploaded cover', () => {
		const { body } = render(TrackCover, {
			props: {
				coverImageUrl: null,
				title: 'Fallback Fixture',
				variant: 'row'
			}
		});

		expect(body).toContain('track-cover__fallback');
		expect(body).not.toContain('<img');
	});

	it('uses active and paused accessibility labels for the selected track', () => {
		const player = createAudioPlayerController();
		player.toggleTrack(playerTrack);
		player.markPlaying();

		const playing = render(TrackPlayButton, {
			props: { track: playerTrack, player }
		}).body;
		expect(playing).toContain('aria-label="Pause Release Fixture Track"');
		expect(playing).toContain('Playing');

		player.toggleTrack(playerTrack);
		player.markPaused();
		const paused = render(TrackPlayButton, {
			props: { track: playerTrack, player }
		}).body;
		expect(paused).toContain('aria-label="Resume Release Fixture Track"');
		expect(paused).toContain('Paused');
	});
});

describe('cover image controls', () => {
	it('renders an optional private-upload control with safe formats and fallback preview', () => {
		const { body } = render(CoverImageField, {
			props: {
				maxSizeMb: 5,
				currentCoverImageUrl: null,
				trackTitle: 'New track'
			}
		});

		expect(body).toContain('name="coverImage"');
		expect(body).toContain('image/jpeg,image/png,image/webp');
		expect(body).toContain('Maximum file size: 5 MB');
		expect(body).toContain('track-cover__fallback');
		expect(body).not.toContain('removeCoverImage');
	});

	it('offers owner removal without exposing a private storage key', () => {
		const { body } = render(CoverImageField, {
			props: {
				maxSizeMb: 5,
				currentCoverImageUrl: '/api/tracks/21/cover',
				allowRemoval: true,
				trackTitle: 'Covered track'
			}
		});

		expect(body).toContain('src="/api/tracks/21/cover"');
		expect(body).toContain('name="removeCoverImage"');
		expect(body).not.toContain('storageKey');
	});
});

describe('SiteHeader navigation', () => {
	it('shows simplified authenticated navigation and profile contents', () => {
		const { body } = render(SiteHeader, {
			props: { user: { username: 'fixture_owner' } }
		});

		expect(body).toContain('href="/tracks">Browse');
		expect(body).toContain('href="/upload">Upload');
		expect(body).toContain('href="/playlists">Playlists');
		expect(body).toContain('aria-label="Open profile menu"');
		expect(body).toContain('aria-controls="desktop-profile-menu"');
		expect(body).toContain('aria-controls="mobile-profile-menu"');
		expect(body.match(/id="desktop-profile-menu"/g)).toHaveLength(1);
		expect(body.match(/id="mobile-profile-menu"/g)).toHaveLength(1);
		expect(body).toMatch(/Signed in as <strong[^>]*>fixture_owner<\/strong>/);
		expect(body).toMatch(/href="\/my-tracks"[^>]*>My Tracks/);
		expect(body).toMatch(/href="\/account"[^>]*>Account/);
		expect(body).toMatch(/method="POST" action="\/logout"/);
		expect(body).not.toContain('href="/">Home</a>');
		expect(body).not.toContain('ownerEmail');
	});

	it('shows equal neutral signed-out navigation styling', () => {
		const { body } = render(SiteHeader, { props: { user: null } });

		expect(body).toMatch(/class="nav-link [^"]*" href="\/tracks">Browse/);
		const loginClass = body.match(/<a class="([^"]*)" href="\/login">Login/)?.[1];
		const registerClass = body.match(
			/<a class="([^"]*)" href="\/register">Register/
		)?.[1];
		expect(loginClass).toBeTruthy();
		expect(registerClass).toBe(loginClass);
		expect(body).not.toContain('register-link');
		expect(body).not.toContain('Open profile menu');
		expect(body).not.toContain('href="/playlists"');
	});
});

describe('add-to-playlist controls', () => {
	it('renders owned playlist membership without internal identity data', () => {
		const { body } = render(AddToPlaylist, {
			props: {
				trackId: 21,
				trackTitle: 'Release Fixture Track',
				choices: [
					{
						publicId: 'abcdefghijklmnopqrstuvwx',
						name: 'Synthetic fixture playlist',
						containsTrack: true
					}
				],
				loginHref: '/login?redirectTo=%2Ftracks%2F21'
			}
		});

		expect(body).toContain('aria-haspopup="dialog"');
		expect(body).toContain('aria-labelledby="playlist-dialog-title-21"');
		expect(body).toContain('name="trackPublicId" value="21"');
		expect(body).toContain('name="playlistPublicId" value="abcdefghijklmnopqrstuvwx"');
		expect(body).toContain('?/removeFromPlaylist');
		expect(body).toContain('Create or manage playlists');
		expect(body).not.toContain('ownerId');
		expect(body).not.toContain('storageKey');
	});

	it('uses the login flow without loading fake playlist choices for guests', () => {
		const { body } = render(AddToPlaylist, {
			props: {
				trackId: 21,
				trackTitle: 'Release Fixture Track',
				choices: null,
				loginHref: '/login?redirectTo=%2Ftracks%2F21'
			}
		});

		expect(body).toContain('href="/login?redirectTo=%2Ftracks%2F21"');
		expect(body).toContain('Log in to add to a playlist');
		expect(body).not.toContain('<dialog');
	});
});

describe('Browse track filters', () => {
	it('keeps one reset action and the existing GET query parameter names', () => {
		const { body } = render(TrackFilters, {
			props: {
				values: {
					q: '',
					bpmMin: '',
					bpmMax: '',
					musicalKey: '',
					genre: '',
					sort: 'newest'
				},
				errors: {}
			}
		});

		expect(body).toContain('method="GET"');
		expect(body).toContain('action="/tracks"');
		for (const name of ['q', 'bpmMin', 'bpmMax', 'musicalKey', 'genre', 'sort']) {
			expect(body).toContain(`name="${name}"`);
		}
		expect(body.match(/Reset filters/g)).toHaveLength(1);
		expect(body).toContain('%, _, and \\ are treated literally.');
	});
});

import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { createAudioPlayerController } from '$lib/player/controller';
import type { PublicPlayerTrack } from '$lib/player/model';
import TrackPlayButton from './TrackPlayButton.svelte';

const track = {
	id: 42,
	title: 'Playlist fixture',
	artist: 'Fixture artist',
	streamUrl: '/api/tracks/42/stream',
	detailsUrl: '/tracks/42'
} as PublicPlayerTrack;

function renderVariant(variant: 'compact' | 'detail' | 'icon'): string {
	return render(TrackPlayButton, {
		props: {
			track,
			player: createAudioPlayerController(),
			variant
		}
	}).body;
}

function hasClassToken(markup: string, className: string): boolean {
	const escapedClassName = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(
		`class="[^"]*\\b${escapedClassName}\\b[^"]*"`
	).test(markup);
}

describe('TrackPlayButton variants', () => {
	it('renders the playlist icon variant as an accessible icon control', () => {
		const body = renderVariant('icon');

		expect(hasClassToken(body, 'track-play-button')).toBe(true);
		expect(hasClassToken(body, 'track-play-button--icon')).toBe(true);
		expect(hasClassToken(body, 'track-play-button--compact')).toBe(false);
		expect(hasClassToken(body, 'track-play-button--detail')).toBe(false);
		expect(hasClassToken(body, 'track-play-button__icon')).toBe(true);
		expect(hasClassToken(body, 'visually-hidden')).toBe(true);
		expect(body).toMatch(/<span[^>]*track-play-button__icon[^>]*>[\s\S]*<svg\b/);
		expect(body).toMatch(/<span[^>]*visually-hidden[^>]*>Play<\/span>/);
		expect(body).toContain('aria-label="Play Playlist fixture"');
		expect(body).toContain('aria-pressed="false"');
		expect(body).toContain('type="button"');
	});

	it.each(['compact', 'detail'] as const)(
		'preserves visible status text for the %s variant',
		(variant) => {
			const body = renderVariant(variant);
			const expectedClass = `track-play-button--${variant}`;

			expect(body).toContain('aria-label="Play Playlist fixture"');
			expect(hasClassToken(body, 'track-play-button')).toBe(true);
			expect(hasClassToken(body, expectedClass)).toBe(true);
			expect(hasClassToken(body, 'track-play-button--icon')).toBe(false);
			expect(
				hasClassToken(
					body,
					variant === 'compact'
						? 'track-play-button--detail'
						: 'track-play-button--compact'
				)
			).toBe(false);
			expect(body).toMatch(/<span[^>]*>Play<\/span>/);
			expect(hasClassToken(body, 'visually-hidden')).toBe(false);
		}
	);
});

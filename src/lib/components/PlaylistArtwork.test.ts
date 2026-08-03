import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import PlaylistArtwork from './PlaylistArtwork.svelte';

describe('PlaylistArtwork', () => {
	it('renders deterministic local fallback artwork without a remote dependency', () => {
		const { body } = render(PlaylistArtwork, { props: { imageUrl: null, name: 'Fallback mix', decorative: false } });
		expect(body).toContain('playlist-artwork__fallback');
		expect(body).toContain('aria-hidden="true"');
		expect(body).not.toContain('<img');
	});

	it('renders an accessible owner-protected image URL when present', () => {
		const { body } = render(PlaylistArtwork, { props: { imageUrl: '/api/playlists/opaque/image', name: 'Image mix', decorative: false } });
		expect(body).toContain('/api/playlists/opaque/image');
		expect(body).toContain('Artwork for Image mix');
	});
});

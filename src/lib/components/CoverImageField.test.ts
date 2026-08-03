import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import CoverImageField from './CoverImageField.svelte';

describe('CoverImageField failure-state recovery', () => {
	it('retains an owner cover-removal request after server validation fails', () => {
		const { body } = render(CoverImageField, {
			props: {
				maxSizeMb: 5,
				currentCoverImageUrl: '/api/tracks/42/cover',
				removeCoverImageRequested: true,
				allowRemoval: true,
				trackTitle: 'Covered fixture'
			}
		});

		expect(body).toMatch(
			/<input[^>]*name="removeCoverImage"[^>]*checked(?:="")?[^>]*>/
		);
		expect(body).toContain('track-cover__fallback');
		expect(body).not.toContain('src="/api/tracks/42/cover"');
	});
});

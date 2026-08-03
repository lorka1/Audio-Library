import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import UploadPage from './upload/+page.svelte';
import EditTrackPage from './my-tracks/[id]/edit/+page.svelte';

describe('track attribution forms', () => {
	it('shows the authenticated uploader without posting an Artist field', () => {
		const { body } = render(UploadPage, {
			props: {
				data: {
					uploaderUsername: 'account_uploader',
					maxAudioFileSizeMb: 80,
					maxCoverImageSizeMb: 5
				},
				form: null,
				params: {}
			} as never
		});

		expect(body).toContain('account_uploader');
		expect(body).toContain('artist is your signed-in username');
		expect(body).not.toContain('name="artist"');
	});

	it('renders uploader attribution as read-only account information while editing', () => {
		const { body } = render(EditTrackPage, {
			props: {
				data: {
					track: {
						publicId: 21,
						title: 'Fixture track',
						artist: 'account_uploader',
						coverImageUrl: null,
						bpm: 120,
						musicalKey: 'C major',
						genre: 'Electronic',
						description: null,
						visibility: 'public',
						fileSizeBytes: 64,
						mimeType: 'audio/mpeg',
						originalFilename: 'fixture.mp3',
						createdAt: nowIso,
						updatedAt: nowIso
					},
					maxCoverImageSizeMb: 5
				},
				form: null,
				params: { id: '21' }
			} as never
		});

		expect(body).toContain('<strong>Artist:</strong> account_uploader');
		expect(body).not.toContain('name="artist"');
	});
});

const nowIso = '2026-08-03T12:00:00.000Z';

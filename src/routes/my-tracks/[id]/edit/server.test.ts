import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	logTrackStorageError: vi.fn(),
	updateTrackMetadata: vi.fn()
}));

vi.mock('$lib/server/config', () => ({
	getServerConfig: () => ({ coverImageMaxSizeBytes: 5 * 1024 * 1024 })
}));
vi.mock('$lib/server/tracks/management', () => ({
	GENERIC_METADATA_UPDATE_ERROR: 'Synthetic update failure.',
	updateTrackMetadata: mocks.updateTrackMetadata
}));
vi.mock('$lib/server/tracks/logging', () => ({
	logTrackStorageError: mocks.logTrackStorageError
}));

import { actions } from './+page.server';

const user = {
	id: '11111111-1111-4111-8111-111111111111',
	username: 'synthetic_owner',
	email: 'synthetic@example.invalid',
	createdAt: new Date('2026-08-01T12:00:00.000Z')
};

function actionEvent(removeCoverImage = true) {
	const body = new FormData();
	body.set('title', '');
	body.set('artist', 'Forged artist');
	body.set('bpm', '120');
	body.set('musicalKey', 'C minor');
	body.set('genre', 'Electronic');
	body.set('description', 'Synthetic validation fixture.');
	if (removeCoverImage) body.set('removeCoverImage', '1');
	return {
		locals: { user, requestId: 'synthetic-request' },
		params: { id: '42' },
		request: new Request('http://localhost/my-tracks/42/edit', {
			method: 'POST',
			body
		})
	} as never;
}

describe('owner track edit failure state', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.updateTrackMetadata.mockResolvedValue({
			success: false,
			status: 400,
			values: {
				title: '',
				bpm: '120',
				musicalKey: 'C minor',
				genre: 'Electronic',
				description: 'Synthetic validation fixture.'
			},
			errors: { title: 'Enter a track title.' }
		});
	});

	it('round-trips a valid cover-removal request with unrelated field errors', async () => {
		await expect(actions.default(actionEvent(true))).resolves.toMatchObject({
			status: 400,
			data: {
				errors: { title: 'Enter a track title.' },
				removeCoverImageRequested: true
			}
		});
	});

	it('does not invent a cover-removal request when none was submitted', async () => {
		await expect(actions.default(actionEvent(false))).resolves.toMatchObject({
			status: 400,
			data: { removeCoverImageRequested: false }
		});
	});

	it('requests replacement-cover reselection when multipart parsing fails', async () => {
		await expect(actions.default({
			locals: { user, requestId: 'synthetic-request' },
			params: { id: '42' },
			request: {
				formData: vi.fn().mockRejectedValue(new Error('synthetic parser failure'))
			}
		} as never)).resolves.toMatchObject({
			status: 400,
			data: {
				needsCoverImageReselection: true,
				removeCoverImageRequested: false
			}
		});
		expect(mocks.logTrackStorageError).toHaveBeenCalledOnce();
	});
});

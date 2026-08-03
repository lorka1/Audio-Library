import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	logTrackStorageError: vi.fn(),
	uploadTrack: vi.fn()
}));

vi.mock('$lib/server/config', () => ({
	getServerConfig: () => ({
		maxAudioFileSizeBytes: 50 * 1024 * 1024,
		coverImageMaxSizeBytes: 5 * 1024 * 1024
	})
}));
vi.mock('$lib/server/tracks/logging', () => ({
	logTrackStorageError: mocks.logTrackStorageError
}));
vi.mock('$lib/server/tracks/service', () => ({
	GENERIC_UPLOAD_ERROR: 'Synthetic upload failure.',
	uploadTrack: mocks.uploadTrack
}));

import { actions } from './+page.server';

const user = {
	id: '11111111-1111-4111-8111-111111111111',
	username: 'synthetic_owner',
	email: 'synthetic@example.invalid',
	createdAt: new Date('2026-08-01T12:00:00.000Z')
};

function parseFailureEvent(error: unknown) {
	return {
		locals: { user, requestId: 'synthetic-request' },
		request: { formData: vi.fn().mockRejectedValue(error) }
	} as never;
}

describe('upload multipart parse failures', () => {
	beforeEach(() => vi.clearAllMocks());

	it('conservatively requests cover reselection after a body-limit failure', async () => {
		await expect(
			actions.default(parseFailureEvent({ status: 413 }))
		).resolves.toMatchObject({
			status: 413,
			data: {
				needsAudioFileReselection: true,
				needsCoverImageReselection: true
			}
		});
		expect(mocks.uploadTrack).not.toHaveBeenCalled();
		expect(mocks.logTrackStorageError).not.toHaveBeenCalled();
	});

	it('does the same after an unreadable multipart request without exposing details', async () => {
		await expect(
			actions.default(parseFailureEvent(new Error('synthetic private parser detail')))
		).resolves.toMatchObject({
			status: 400,
			data: {
				needsAudioFileReselection: true,
				needsCoverImageReselection: true
			}
		});
		expect(mocks.logTrackStorageError).toHaveBeenCalledOnce();
	});
});

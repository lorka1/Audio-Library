import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	findTrackCoverForAccess: vi.fn(),
	getApplicationTrackRepository: vi.fn(),
	readStoredCoverImageFile: vi.fn(),
	logTrackStorageError: vi.fn()
}));

vi.mock('$lib/server/config', () => ({
	getServerConfig: () => ({ coverImageMaxSizeBytes: 5 * 1024 * 1024 })
}));
vi.mock('$lib/server/tracks/persistence', () => ({
	getApplicationTrackRepository: mocks.getApplicationTrackRepository
}));
vi.mock('$lib/server/tracks/cover-files', () => ({
	readStoredCoverImageFile: mocks.readStoredCoverImageFile
}));
vi.mock('$lib/server/tracks/logging', () => ({
	logTrackStorageError: mocks.logTrackStorageError
}));

import { GET } from './+server';

function event(id: string, userId?: string) {
	return {
		params: { id },
		locals: {
			user: userId ? { id: userId } : null
		}
	} as Parameters<typeof GET>[0];
}

describe('GET track cover image', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getApplicationTrackRepository.mockResolvedValue({
			findTrackCoverForAccess: mocks.findTrackCoverForAccess
		});
		mocks.findTrackCoverForAccess.mockResolvedValue({
			publicId: 42,
			storageKey: '550e8400-e29b-41d4-a716-446655440000.png',
			mimeType: 'image/png',
			byteSize: 4
		});
		mocks.readStoredCoverImageFile.mockResolvedValue({
			success: true,
			file: {
				bytes: new Uint8Array([1, 2, 3, 4]),
				fileSizeBytes: 4,
				mimeType: 'image/png'
			}
		});
	});

	it('serves bounded public bytes without exposing a storage key', async () => {
		const response = await GET(event('42'));
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/png');
		expect(response.headers.get('content-length')).toBe('4');
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(
			new Uint8Array([1, 2, 3, 4])
		);
		expect(mocks.findTrackCoverForAccess).toHaveBeenCalledWith(42, undefined);
		expect([...response.headers.values()].join(' ')).not.toContain('550e8400');
	});

	it('passes only the authenticated owner identity for owner-safe private access', async () => {
		const response = await GET(event('42', 'authenticated-owner'));
		expect(response.status).toBe(200);
		expect(mocks.findTrackCoverForAccess).toHaveBeenCalledWith(
			42,
			'authenticated-owner'
		);
	});

	it.each(['not-a-track', '0', '../42'])(
		'returns a uniform safe 404 for invalid ID %s',
		async (id) => {
			const response = await GET(event(id));
			expect(response.status).toBe(404);
			expect(mocks.getApplicationTrackRepository).not.toHaveBeenCalled();
		}
	);

	it('returns the same 404 for inaccessible, missing, or invalid stored covers', async () => {
		mocks.findTrackCoverForAccess.mockResolvedValueOnce(null);
		expect((await GET(event('42'))).status).toBe(404);

		mocks.readStoredCoverImageFile.mockResolvedValueOnce({
			success: false,
			reason: 'invalid'
		});
		expect((await GET(event('42'))).status).toBe(404);
	});

	it('sanitizes repository and filesystem availability failures', async () => {
		mocks.getApplicationTrackRepository.mockRejectedValueOnce(
			new Error('C:\\private\\database')
		);
		const databaseResponse = await GET(event('42'));
		expect(databaseResponse.status).toBe(500);
		expect(await databaseResponse.text()).not.toContain('C:\\private');

		mocks.readStoredCoverImageFile.mockResolvedValueOnce({
			success: false,
			reason: 'unavailable'
		});
		const fileResponse = await GET(event('42'));
		expect(fileResponse.status).toBe(500);
	});
});

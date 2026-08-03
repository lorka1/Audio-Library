import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ repository: vi.fn(), read: vi.fn() }));
vi.mock('$lib/server/playlists/persistence', () => ({ getApplicationPlaylistRepository: mocks.repository }));
vi.mock('$lib/server/playlists/image-files', () => ({ readStoredPlaylistImageFile: mocks.read }));
vi.mock('$lib/server/config', () => ({ getServerConfig: () => ({ playlistImageMaxSizeBytes: 1024 }) }));

import { GET } from './+server';
const publicId = 'abcdefghijklmnopqrstuvwx';
const user = { id: 'owner', username: 'owner' };

function event(authenticated = true, id = publicId) {
	return { locals: { user: authenticated ? user : null }, params: { publicId: id } } as never;
}

describe('GET owner playlist image', () => {
	beforeEach(() => vi.clearAllMocks());
	it('serves bounded image bytes only through the owner-scoped lookup', async () => {
		const find = vi.fn().mockResolvedValue({ storageKey: 'private.png', mimeType: 'image/png', byteSize: 4 });
		mocks.repository.mockResolvedValue({ findPlaylistImageForOwner: find });
		mocks.read.mockResolvedValue({ success: true, file: { bytes: new Uint8Array([1, 2, 3, 4]), fileSizeBytes: 4, mimeType: 'image/png' } });
		const response = await GET(event());
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(response.headers.get('content-type')).toBe('image/png');
		expect(find).toHaveBeenCalledWith(user.id, publicId);
	});

	it('returns the same safe 404 for unauthenticated, malformed, missing, and non-owned images', async () => {
		const find = vi.fn().mockResolvedValue(null);
		mocks.repository.mockResolvedValue({ findPlaylistImageForOwner: find });
		for (const current of [event(false), event(true, '../guess'), event()]) {
			expect((await GET(current)).status).toBe(404);
		}
		expect(mocks.read).not.toHaveBeenCalled();
	});
});

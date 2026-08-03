import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getApplicationPlaylistRepository: vi.fn()
}));

vi.mock('$lib/server/playlists/persistence', () => ({
	getApplicationPlaylistRepository: mocks.getApplicationPlaylistRepository
}));

import { actions, load } from './+page.server';

const publicId = 'abcdefghijklmnopqrstuvwx';
const user = {
	id: '11111111-1111-4111-8111-111111111111',
	username: 'synthetic_owner',
	email: 'synthetic@example.invalid',
	createdAt: new Date('2026-07-30T12:00:00.000Z')
};
const playlist = {
	publicId,
	name: 'Synthetic playlist',
	description: null,
	imageUrl: null,
	trackCount: 0,
	createdAt: '2026-07-30T12:00:00.000Z',
	updatedAt: '2026-07-30T12:00:00.000Z',
	tracks: [],
	unavailableTrackCount: 0
};

function event(method = 'GET', formData?: FormData, id = publicId) {
	return {
		locals: { user, requestId: 'synthetic-request' },
		params: { publicId: id },
		url: new URL(`http://localhost/playlists/${id}`),
		request: new Request(`http://localhost/playlists/${id}`, {
			method,
			...(formData ? { body: formData } : {})
		})
	} as never;
}

describe('/playlists/[publicId] owner boundary', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns the safe owner playlist and uses a 404 for a guessed non-owned ID', async () => {
		const find = vi.fn().mockResolvedValueOnce(playlist).mockResolvedValueOnce(null);
		mocks.getApplicationPlaylistRepository.mockResolvedValue({ findPlaylistForOwner: find });
		await expect(load(event())).resolves.toMatchObject({ playlist });
		expect(find).toHaveBeenCalledWith(user.id, publicId);
		await expect(load(event())).rejects.toMatchObject({ status: 404, body: { message: 'Playlist not found.' } });
	});

	it('rejects malformed public IDs as the same safe 404', async () => {
		await expect(load(event('GET', undefined, '../guess'))).rejects.toMatchObject({ status: 404 });
		expect(mocks.getApplicationPlaylistRepository).not.toHaveBeenCalled();
	});

	it('updates only via the authenticated owner-scoped operation', async () => {
		const update = vi.fn().mockResolvedValue(playlist);
		mocks.getApplicationPlaylistRepository.mockResolvedValue({ updatePlaylistForOwner: update });
		const body = new FormData();
		body.set('name', 'Renamed synthetic playlist');
		body.set('description', 'Updated description');
		await expect(actions.update(event('POST', body))).rejects.toMatchObject({
			status: 303,
			location: `/playlists/${publicId}?updated=1`
		});
		expect(update).toHaveBeenCalledWith(user.id, publicId, {
			name: 'Renamed synthetic playlist',
			description: 'Updated description'
		});
	});

	it('requires explicit confirmation and cascades through the repository', async () => {
		const deletePlaylist = vi.fn().mockResolvedValue(true);
		mocks.getApplicationPlaylistRepository.mockResolvedValue({
			deletePlaylistForOwner: deletePlaylist,
			findPlaylistImageStorageForOwner: vi.fn().mockResolvedValue({ publicId, image: null })
		});
		await expect(actions.delete(event('POST', new FormData()))).resolves.toMatchObject({
			status: 400,
			data: { action: 'delete' }
		});
		expect(deletePlaylist).not.toHaveBeenCalled();

		const confirmed = new FormData();
		confirmed.set('confirmDelete', 'delete');
		await expect(actions.delete(event('POST', confirmed))).rejects.toMatchObject({
			status: 303,
			location: '/playlists?deleted=1'
		});
		expect(deletePlaylist).toHaveBeenCalledWith(user.id, publicId);
	});

	it('does not distinguish a missing playlist from a non-owned playlist on mutation', async () => {
		mocks.getApplicationPlaylistRepository.mockResolvedValue({
			updatePlaylistForOwner: vi.fn().mockResolvedValue(null),
			deletePlaylistForOwner: vi.fn().mockResolvedValue(false),
			findPlaylistImageStorageForOwner: vi.fn().mockResolvedValue(null)
		});
		const updateBody = new FormData();
		updateBody.set('name', 'Synthetic');
		updateBody.set('description', '');
		await expect(actions.update(event('POST', updateBody))).rejects.toMatchObject({ status: 404 });
		const deleteBody = new FormData();
		deleteBody.set('confirmDelete', 'delete');
		await expect(actions.delete(event('POST', deleteBody))).rejects.toMatchObject({ status: 404 });
	});
});

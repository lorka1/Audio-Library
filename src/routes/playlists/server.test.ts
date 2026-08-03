import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getApplicationPlaylistRepository: vi.fn()
}));

vi.mock('$lib/server/playlists/persistence', () => ({
	getApplicationPlaylistRepository: mocks.getApplicationPlaylistRepository
}));

import { actions, load } from './+page.server';

const user = {
	id: '11111111-1111-4111-8111-111111111111',
	username: 'synthetic_owner',
	email: 'synthetic@example.invalid',
	createdAt: new Date('2026-07-30T12:00:00.000Z')
};

function loadEvent(authenticated = true) {
	return {
		locals: { user: authenticated ? user : null, requestId: 'synthetic-request' },
		url: new URL('http://localhost/playlists'),
		request: new Request('http://localhost/playlists')
	} as never;
}

function actionEvent(name: string, description = '') {
	const body = new FormData();
	body.set('name', name);
	body.set('description', description);
	return {
		locals: { user, requestId: 'synthetic-request' },
		url: new URL('http://localhost/playlists?/create'),
		request: new Request('http://localhost/playlists?/create', { method: 'POST', body })
	} as never;
}

describe('/playlists server behavior', () => {
	beforeEach(() => vi.clearAllMocks());

	it('requires authentication and lists only through the owner-scoped repository call', async () => {
		const list = vi.fn().mockResolvedValue([]);
		mocks.getApplicationPlaylistRepository.mockResolvedValue({ listPlaylistsForOwner: list });
		await expect(load(loadEvent())).resolves.toMatchObject({ playlists: [] });
		expect(list).toHaveBeenCalledWith(user.id);
		await expect(load(loadEvent(false))).rejects.toMatchObject({ status: 303 });
	});

	it('creates a normalized private playlist and redirects after POST', async () => {
		const create = vi.fn().mockResolvedValue({});
		mocks.getApplicationPlaylistRepository.mockResolvedValue({ createPlaylist: create });
		await expect(actions.create(actionEvent('  Synthetic mix  ', '   '))).rejects.toMatchObject({
			status: 303,
			location: '/playlists?created=1'
		});
		expect(create).toHaveBeenCalledWith(user.id, { name: 'Synthetic mix', description: null, image: null });
	});

	it('returns field validation without calling MongoDB', async () => {
		await expect(actions.create(actionEvent('   '))).resolves.toMatchObject({
			status: 400,
			data: { action: 'create', errors: { name: 'Enter a playlist name.' } }
		});
		expect(mocks.getApplicationPlaylistRepository).not.toHaveBeenCalled();
	});
});

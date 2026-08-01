import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getApplicationPlaylistRepository: vi.fn()
}));

vi.mock('./persistence', () => ({
	getApplicationPlaylistRepository: mocks.getApplicationPlaylistRepository
}));

import {
	addTrackToPlaylistAction,
	playlistStatusMessage,
	removeTrackFromPlaylistAction
} from './actions';

const user = {
	id: '11111111-1111-4111-8111-111111111111',
	username: 'synthetic_owner',
	email: 'synthetic@example.invalid',
	createdAt: new Date('2026-07-30T12:00:00.000Z')
};

function event(action: string, values: Record<string, string>, authenticated = true) {
	const body = new FormData();
	for (const [key, value] of Object.entries(values)) body.set(key, value);
	return {
		locals: { user: authenticated ? user : null, requestId: 'synthetic-request' },
		url: new URL(`http://localhost/tracks?sort=newest&/${action}`),
		request: new Request(`http://localhost/tracks?/${action}`, { method: 'POST', body })
	} as never;
}

describe('playlist membership actions', () => {
	beforeEach(() => vi.clearAllMocks());

	it('adds by safe public IDs and redirects through PRG', async () => {
		const add = vi.fn().mockResolvedValue('added');
		mocks.getApplicationPlaylistRepository.mockResolvedValue({ addTrackToPlaylist: add });

		await expect(addTrackToPlaylistAction(event('addToPlaylist', {
			playlistPublicId: 'abcdefghijklmnopqrstuvwx',
			trackPublicId: '21'
		}))).rejects.toMatchObject({
			status: 303,
			location: expect.stringContaining('playlistStatus=added')
		});
		expect(add).toHaveBeenCalledWith(user.id, 'abcdefghijklmnopqrstuvwx', 21);
	});

	it('uses the same safe response for missing, inaccessible, and non-owned targets', async () => {
		mocks.getApplicationPlaylistRepository.mockResolvedValue({
			addTrackToPlaylist: vi.fn().mockResolvedValue('track-unavailable')
		});
		await expect(addTrackToPlaylistAction(event('addToPlaylist', {
			playlistPublicId: 'abcdefghijklmnopqrstuvwx',
			trackPublicId: '21'
		}))).rejects.toMatchObject({
			status: 303,
			location: expect.stringContaining('playlistStatus=error')
		});
	});

	it('removes an exact public track membership without accepting an owner ID', async () => {
		const remove = vi.fn().mockResolvedValue('removed');
		mocks.getApplicationPlaylistRepository.mockResolvedValue({ removeTrackFromPlaylist: remove });
		await expect(removeTrackFromPlaylistAction(event('removeFromPlaylist', {
			playlistPublicId: 'abcdefghijklmnopqrstuvwx',
			trackPublicId: '21',
			ownerId: 'attacker-controlled'
		}))).rejects.toMatchObject({
			status: 303,
			location: expect.stringContaining('playlistStatus=removed')
		});
		expect(remove).toHaveBeenCalledWith(user.id, 'abcdefghijklmnopqrstuvwx', 21);
	});

	it('rejects malformed IDs before repository access', async () => {
		mocks.getApplicationPlaylistRepository.mockResolvedValue({ addTrackToPlaylist: vi.fn() });
		await expect(addTrackToPlaylistAction(event('addToPlaylist', {
			playlistPublicId: '../guessed',
			trackPublicId: 'not-a-track'
		}))).rejects.toMatchObject({ status: 303 });
		expect(mocks.getApplicationPlaylistRepository).not.toHaveBeenCalled();
	});

	it('provides accessible success and error copy for the pages', () => {
		expect(playlistStatusMessage('added')).toEqual({
			kind: 'success',
			message: 'Track added to the playlist.'
		});
		expect(playlistStatusMessage('error')?.kind).toBe('error');
		expect(playlistStatusMessage('unknown')).toBeNull();
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getApplicationPlaylistRepository: vi.fn()
}));

vi.mock('./persistence', () => ({
	getApplicationPlaylistRepository: mocks.getApplicationPlaylistRepository
}));

import { getPlaylistChoicesForTracks } from './picker';

describe('playlist picker projection', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns owner-safe public IDs, names, and membership only', async () => {
		mocks.getApplicationPlaylistRepository.mockResolvedValue({
			listPlaylistsForOwner: vi.fn().mockResolvedValue([
				{
					publicId: 'abcdefghijklmnopqrstuvwx',
					name: 'Synthetic playlist',
					description: 'Private description',
					trackCount: 1,
					createdAt: '2026-07-30T12:00:00.000Z',
					updatedAt: '2026-07-30T12:00:00.000Z'
				}
			]),
			getTrackPlaylistMemberships: vi.fn().mockResolvedValue({
				'21': ['abcdefghijklmnopqrstuvwx']
			})
		});

		const result = await getPlaylistChoicesForTracks('internal-owner-id', [21]);
		expect(result).toEqual({
			'21': [{
				publicId: 'abcdefghijklmnopqrstuvwx',
				name: 'Synthetic playlist',
				containsTrack: true
			}]
		});
		expect(JSON.stringify(result)).not.toContain('internal-owner-id');
		expect(JSON.stringify(result)).not.toContain('Private description');
	});
});

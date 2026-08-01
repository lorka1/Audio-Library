import type { PlaylistPickerEntry } from '$lib/types';
import { getApplicationPlaylistRepository } from './persistence';

export async function getPlaylistChoicesForTracks(
	ownerId: string,
	trackPublicIds: number[]
): Promise<Record<string, PlaylistPickerEntry[]>> {
	const repository = await getApplicationPlaylistRepository();
	const [playlists, memberships] = await Promise.all([
		repository.listPlaylistsForOwner(ownerId),
		repository.getTrackPlaylistMemberships(ownerId, trackPublicIds)
	]);
	return Object.fromEntries(trackPublicIds.map((trackId) => {
		const memberOf = new Set(memberships[String(trackId)] ?? []);
		return [String(trackId), playlists.map(({ publicId, name }) => ({
			publicId,
			name,
			containsTrack: memberOf.has(publicId)
		}))];
	}));
}

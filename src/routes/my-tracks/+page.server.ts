import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireUser } from '$lib/server/auth/guards';
import { logTrackStorageError } from '$lib/server/tracks/logging';
import { getApplicationTrackRepository } from '$lib/server/tracks/persistence';
import { getPlaylistChoicesForTracks } from '$lib/server/playlists/picker';
import {
	addTrackToPlaylistAction,
	playlistStatusMessage,
	removeTrackFromPlaylistAction
} from '$lib/server/playlists/actions';

export const load = (async (event) => {
	const user = requireUser(event);

	try {
		const tracks = await (
				await getApplicationTrackRepository()
			).listTracksForOwner(user.id);
		return {
			tracks,
			playlistChoices: await getPlaylistChoicesForTracks(
				user.id,
				tracks.map(({ publicId }) => publicId)
			),
			playlistNotice: playlistStatusMessage(event.url.searchParams.get('playlistStatus')),
			updated: event.url.searchParams.get('updated') === '1',
			deleted: event.url.searchParams.get('deleted') === '1'
		};
	} catch (loadError) {
		logTrackStorageError('Unable to list owner-managed tracks.', loadError);
		error(500, 'Your tracks are temporarily unavailable.');
	}
}) satisfies PageServerLoad;

export const actions = {
	addToPlaylist: addTrackToPlaylistAction,
	removeFromPlaylist: removeTrackFromPlaylistAction
} satisfies Actions;

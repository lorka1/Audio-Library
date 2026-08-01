import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parseTrackId } from '$lib/server/tracks/id';
import { logTrackStorageError } from '$lib/server/tracks/logging';
import { getApplicationTrackRepository } from '$lib/server/tracks/persistence';
import { getPlaylistChoicesForTracks } from '$lib/server/playlists/picker';
import {
	addTrackToPlaylistAction,
	playlistStatusMessage,
	removeTrackFromPlaylistAction
} from '$lib/server/playlists/actions';

export const load = (async ({ locals, params, url }) => {
	const id = parseTrackId(params.id);

	if (id === null) {
		error(404, 'Track not found.');
	}

	try {
		const repository = await getApplicationTrackRepository();
		const track = await repository.findPublicTrackByPublicId(id);

		if (!track) {
			error(404, 'Track not found.');
		}

		return {
			track,
			playlistChoices: locals.user
				? (await getPlaylistChoicesForTracks(locals.user.id, [id]))[String(id)]
				: null,
			playlistNotice: playlistStatusMessage(url.searchParams.get('playlistStatus')),
			loginHref: `/login?redirectTo=${encodeURIComponent(`${url.pathname}${url.search}`)}`,
			canManage: locals.user
				? (await repository.findOwnerTrack(id, locals.user.id)) !== null
				: false,
			uploaded: url.searchParams.get('uploaded') === '1'
		};
	} catch (loadError) {
		if (
			typeof loadError === 'object' &&
			loadError !== null &&
			'status' in loadError &&
			loadError.status === 404
		) {
			throw loadError;
		}

		logTrackStorageError('Unable to load a public track.', loadError);
		error(500, 'The track is temporarily unavailable.');
	}
}) satisfies PageServerLoad;

export const actions = {
	addToPlaylist: addTrackToPlaylistAction,
	removeFromPlaylist: removeTrackFromPlaylistAction
} satisfies Actions;

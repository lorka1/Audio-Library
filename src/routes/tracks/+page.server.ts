import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { logTrackStorageError } from '$lib/server/tracks/logging';
import { parseTrackQuery } from '$lib/server/tracks/query';
import { getApplicationTrackRepository } from '$lib/server/tracks/persistence';
import {
	getActiveTrackFilterSummary,
	hasActiveTrackFilters
} from '$lib/tracks-query';
import { getPlaylistChoicesForTracks } from '$lib/server/playlists/picker';
import {
	addTrackToPlaylistAction,
	playlistStatusMessage,
	removeTrackFromPlaylistAction
} from '$lib/server/playlists/actions';

export const load = (async ({ locals, url }) => {
	const parsedQuery = parseTrackQuery(url.searchParams);

	if (!parsedQuery.isValid) {
		return {
			tracks: [],
			filterValues: parsedQuery.values,
			filterErrors: parsedQuery.errors,
			activeFilterSummary: getActiveTrackFilterSummary(parsedQuery.filters),
			hasActiveFilters: true
		};
	}

	try {
		const tracks = await (
				await getApplicationTrackRepository()
			).listPublicTracks(parsedQuery.filters);
		return {
			tracks,
			playlistChoices: locals.user
				? await getPlaylistChoicesForTracks(locals.user.id, tracks.map(({ id }) => id))
				: null,
			playlistNotice: playlistStatusMessage(url.searchParams.get('playlistStatus')),
			loginHref: `/login?redirectTo=${encodeURIComponent(`${url.pathname}${url.search}`)}`,
			filterValues: parsedQuery.values,
			filterErrors: parsedQuery.errors,
			activeFilterSummary: getActiveTrackFilterSummary(parsedQuery.filters),
			hasActiveFilters: hasActiveTrackFilters(parsedQuery.filters)
		};
	} catch (loadError) {
		logTrackStorageError('Unable to list public tracks.', loadError);
		error(500, 'Public tracks are temporarily unavailable.');
	}
}) satisfies PageServerLoad;

export const actions = {
	addToPlaylist: addTrackToPlaylistAction,
	removeFromPlaylist: removeTrackFromPlaylistAction
} satisfies Actions;

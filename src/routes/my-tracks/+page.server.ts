import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireUser } from '$lib/server/auth/guards';
import { logTrackStorageError } from '$lib/server/tracks/logging';
import { getApplicationTrackRepository } from '$lib/server/tracks/persistence';

export const load = (async (event) => {
	const user = requireUser(event);

	try {
		return {
			tracks: await getApplicationTrackRepository().listTracksForOwner(user.id),
			updated: event.url.searchParams.get('updated') === '1',
			deleted: event.url.searchParams.get('deleted') === '1'
		};
	} catch (loadError) {
		logTrackStorageError('Unable to list owner-managed tracks.', loadError);
		error(500, 'Your tracks are temporarily unavailable.');
	}
}) satisfies PageServerLoad;

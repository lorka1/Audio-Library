import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireUser } from '$lib/server/auth/guards';
import { logTrackStorageError } from '$lib/server/tracks/logging';
import { listTracksByOwner } from '$lib/server/tracks/repository';

export const load = (async (event) => {
	const user = requireUser(event);

	try {
		return {
			tracks: await listTracksByOwner(user.id),
			updated: event.url.searchParams.get('updated') === '1',
			deleted: event.url.searchParams.get('deleted') === '1'
		};
	} catch (loadError) {
		logTrackStorageError('Unable to list owner-managed tracks.', loadError);
		error(500, 'Your tracks are temporarily unavailable.');
	}
}) satisfies PageServerLoad;

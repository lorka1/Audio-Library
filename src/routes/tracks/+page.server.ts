import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { logTrackStorageError } from '$lib/server/tracks/logging';
import { listPublicTracks } from '$lib/server/tracks/repository';

export const load = (async () => {
	try {
		return {
			tracks: await listPublicTracks()
		};
	} catch (loadError) {
		logTrackStorageError('Unable to list public tracks.', loadError);
		error(500, 'Public tracks are temporarily unavailable.');
	}
}) satisfies PageServerLoad;

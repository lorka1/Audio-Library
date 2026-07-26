import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireUser } from '$lib/server/auth/guards';
import { parseTrackId } from '$lib/server/tracks/id';
import { logTrackStorageError } from '$lib/server/tracks/logging';
import { deleteTrack } from '$lib/server/tracks/management';
import { findOwnedTrackByPublicId } from '$lib/server/tracks/repository';

export const load = (async (event) => {
	const user = requireUser(event);
	const publicId = parseTrackId(event.params.id);

	if (publicId === null) {
		error(404, 'Track not found.');
	}

	try {
		const track = await findOwnedTrackByPublicId(publicId, user.id);

		if (!track) {
			error(404, 'Track not found.');
		}

		return {
			track: {
				title: track.title,
				artist: track.artist
			}
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

		logTrackStorageError('Unable to load owner track deletion confirmation.', loadError);
		error(500, 'The track is temporarily unavailable.');
	}
}) satisfies PageServerLoad;

export const actions = {
	default: async (event) => {
		const user = requireUser(event);
		const publicId = parseTrackId(event.params.id);

		if (publicId === null) {
			error(404, 'Track not found.');
		}

		const result = await deleteTrack({
			publicId,
			ownerId: user.id
		});

		if (!result.success) {
			if (result.status === 404) {
				error(404, 'Track not found.');
			}

			return fail(500, { message: result.message });
		}

		redirect(303, '/my-tracks?deleted=1');
	}
} satisfies Actions;

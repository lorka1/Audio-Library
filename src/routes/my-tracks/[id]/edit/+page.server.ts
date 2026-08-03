import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireUser } from '$lib/server/auth/guards';
import { getServerConfig } from '$lib/server/config';
import {
	GENERIC_METADATA_UPDATE_ERROR,
	updateTrackMetadata
} from '$lib/server/tracks/management';
import { parseTrackId } from '$lib/server/tracks/id';
import { logTrackStorageError } from '$lib/server/tracks/logging';
import { getApplicationTrackRepository } from '$lib/server/tracks/persistence';
import {
	emptyTrackMetadataFormValues,
	hasSelectedCoverImage,
	hasRequestedCoverImageRemoval,
	type TrackMetadataErrors
} from '$lib/server/tracks/validation';

export const load = (async (event) => {
	const user = requireUser(event);
	const config = getServerConfig();
	const publicId = parseTrackId(event.params.id);

	if (publicId === null) {
		error(404, 'Track not found.');
	}

	try {
		const track = await (await getApplicationTrackRepository()).findOwnerTrack(
			publicId,
			user.id
		);

		if (!track) {
			error(404, 'Track not found.');
		}

		return {
			track,
			maxCoverImageSizeMb: config.coverImageMaxSizeMb
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

		logTrackStorageError('Unable to load owner track metadata for editing.', loadError);
		error(500, 'The track is temporarily unavailable.');
	}
}) satisfies PageServerLoad;

export const actions = {
	default: async (event) => {
		const user = requireUser(event);
		const config = getServerConfig();
		const publicId = parseTrackId(event.params.id);

		if (publicId === null) {
			error(404, 'Track not found.');
		}

		let formData: FormData;

		try {
			formData = await event.request.formData();
		} catch (formError) {
			logTrackStorageError('Unable to parse a track metadata update.', formError);
			const errors: TrackMetadataErrors = {
				general: GENERIC_METADATA_UPDATE_ERROR
			};

			return fail(400, {
				values: emptyTrackMetadataFormValues(),
				errors,
				needsCoverImageReselection: true,
				removeCoverImageRequested: false
			});
		}

		const needsCoverImageReselection = hasSelectedCoverImage(formData);
		const removeCoverImageRequested = hasRequestedCoverImageRemoval(formData);
		const result = await updateTrackMetadata({
			publicId,
			ownerId: user.id,
			formData,
			maxCoverImageSizeBytes: config.coverImageMaxSizeBytes
		});

		if (!result.success) {
			if (result.status === 404) {
				error(404, 'Track not found.');
			}

			return fail(result.status, {
				values: result.values,
				errors: result.errors,
				needsCoverImageReselection,
				removeCoverImageRequested
			});
		}

		redirect(303, '/my-tracks?updated=1');
	}
} satisfies Actions;

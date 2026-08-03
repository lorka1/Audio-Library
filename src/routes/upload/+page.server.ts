import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireUser } from '$lib/server/auth/guards';
import { getServerConfig } from '$lib/server/config';
import { logTrackStorageError } from '$lib/server/tracks/logging';
import { GENERIC_UPLOAD_ERROR, uploadTrack } from '$lib/server/tracks/service';
import {
	audioFileTooLargeMessage,
	emptyUploadFormValues,
	hasSelectedCoverImage,
	type UploadErrors,
	type UploadFormValues
} from '$lib/server/tracks/validation';

interface UploadFailureData {
	values: UploadFormValues;
	errors: UploadErrors;
	needsAudioFileReselection: true;
	needsCoverImageReselection: boolean;
}

function uploadFailureData(
	values: UploadFormValues,
	errors: UploadErrors,
	needsCoverImageReselection = false
): UploadFailureData {
	return {
		values,
		errors,
		needsAudioFileReselection: true,
		needsCoverImageReselection
	};
}

function readHttpStatus(error: unknown): number | null {
	if (typeof error !== 'object' || error === null || !('status' in error)) {
		return null;
	}

	const status = (error as { status?: unknown }).status;
	return typeof status === 'number' ? status : null;
}

export const load = ((event) => {
	requireUser(event);
	const config = getServerConfig();

	return {
		maxAudioFileSizeMb: config.maxAudioFileSizeMb,
		maxCoverImageSizeMb: config.coverImageMaxSizeMb
	};
}) satisfies PageServerLoad;

export const actions = {
	default: async (event) => {
		const user = requireUser(event);
		const config = getServerConfig();
		let formData: FormData;
		let createdTrackId: number;

		try {
			formData = await event.request.formData();
		} catch (error) {
			const requestTooLarge = readHttpStatus(error) === 413;

			if (!requestTooLarge) {
				logTrackStorageError('Unable to parse an audio upload request.', error);
			}

			return fail(
				requestTooLarge ? 413 : 400,
				uploadFailureData(emptyUploadFormValues(), {
					...(requestTooLarge
						? { audioFile: audioFileTooLargeMessage(config.maxAudioFileSizeBytes) }
						: { general: GENERIC_UPLOAD_ERROR })
				}, true)
			);
		}

		try {
			const result = await uploadTrack({
				ownerId: user.id,
				formData,
				maxFileSizeBytes: config.maxAudioFileSizeBytes,
				maxCoverImageSizeBytes: config.coverImageMaxSizeBytes
			});

			if (!result.success) {
				return fail(
					result.status,
					uploadFailureData(
						result.values,
						result.errors,
						result.needsCoverImageReselection
					)
				);
			}

			createdTrackId = result.track.id;
		} catch (error) {
			logTrackStorageError('Unexpected audio upload failure.', error);
			return fail(
				500,
				uploadFailureData(
					emptyUploadFormValues(),
					{ general: GENERIC_UPLOAD_ERROR },
					hasSelectedCoverImage(formData)
				)
			);
		}

		redirect(303, `/tracks/${createdTrackId}?uploaded=1`);
	}
} satisfies Actions;

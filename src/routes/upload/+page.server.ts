import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireUser } from '$lib/server/auth/guards';
import { serverConfig } from '$lib/server/config';
import { logTrackStorageError } from '$lib/server/tracks/logging';
import { GENERIC_UPLOAD_ERROR, uploadTrack } from '$lib/server/tracks/service';
import {
	audioFileTooLargeMessage,
	emptyUploadFormValues,
	type UploadErrors,
	type UploadFormValues
} from '$lib/server/tracks/validation';

interface UploadFailureData {
	values: UploadFormValues;
	errors: UploadErrors;
	needsAudioFileReselection: true;
}

function uploadFailureData(
	values: UploadFormValues,
	errors: UploadErrors
): UploadFailureData {
	return {
		values,
		errors,
		needsAudioFileReselection: true
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

	return {
		maxAudioFileSizeMb: serverConfig.maxAudioFileSizeMb
	};
}) satisfies PageServerLoad;

export const actions = {
	default: async (event) => {
		const user = requireUser(event);
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
						? { audioFile: audioFileTooLargeMessage(serverConfig.maxAudioFileSizeBytes) }
						: { general: GENERIC_UPLOAD_ERROR })
				})
			);
		}

		try {
			const result = await uploadTrack({
				ownerId: user.id,
				formData,
				maxFileSizeBytes: serverConfig.maxAudioFileSizeBytes
			});

			if (!result.success) {
				return fail(result.status, uploadFailureData(result.values, result.errors));
			}

			createdTrackId = result.track.id;
		} catch (error) {
			logTrackStorageError('Unexpected audio upload failure.', error);
			return fail(
				500,
				uploadFailureData(emptyUploadFormValues(), { general: GENERIC_UPLOAD_ERROR })
			);
		}

		redirect(303, `/tracks/${createdTrackId}?uploaded=1`);
	}
} satisfies Actions;

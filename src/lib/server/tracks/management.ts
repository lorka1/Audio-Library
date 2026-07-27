import type { OwnerTrack } from '$lib/types';
import {
	deleteQuarantinedAudioFile,
	quarantineStoredAudioFile,
	restoreQuarantinedAudioFile,
	type QuarantinedAudioFile,
	type QuarantineStoredAudioFileResult
} from './files';
import { logTrackStorageError } from './logging';
import {
	type OwnedTrackFile,
	type UpdateOwnedTrackMetadataInput
} from './repository';
import { getApplicationTrackRepository } from './persistence';
import {
	validateTrackMetadataFormData,
	type TrackMetadataErrors,
	type TrackMetadataFormValues
} from './validation';

export const GENERIC_METADATA_UPDATE_ERROR =
	'Unable to update the track metadata. Please try again.';
export const GENERIC_TRACK_DELETE_ERROR =
	'Unable to delete the track. Please try again.';

export interface TrackManagementDependencies {
	updateMetadata(
		publicId: number,
		ownerId: string,
		metadata: UpdateOwnedTrackMetadataInput
	): Promise<OwnerTrack | null>;
	findFile(publicId: number, ownerId: string): Promise<OwnedTrackFile | null>;
	deleteRecord(publicId: number, ownerId: string): Promise<boolean>;
	quarantineFile(storedFilename: string): Promise<QuarantineStoredAudioFileResult>;
	deleteQuarantinedFile(file: QuarantinedAudioFile): Promise<void>;
	restoreQuarantinedFile(file: QuarantinedAudioFile): Promise<void>;
	now(): Date;
}

export interface UpdateTrackMetadataInput {
	publicId: number;
	ownerId: string;
	formData: FormData;
}

export type UpdateTrackMetadataResult =
	| {
			success: true;
	  }
	| {
			success: false;
			status: 400 | 404 | 500;
			values: TrackMetadataFormValues;
			errors: TrackMetadataErrors;
	  };

export interface DeleteTrackInput {
	publicId: number;
	ownerId: string;
}

export type DeleteTrackResult =
	| {
			success: true;
	  }
	| {
			success: false;
			status: 404 | 500;
			message: string;
	  };

const defaultDependencies: TrackManagementDependencies = {
	updateMetadata: (publicId, ownerId, metadata) =>
		getApplicationTrackRepository().updateOwnerTrackMetadata(
			publicId,
			ownerId,
			metadata
		),
	findFile: (publicId, ownerId) =>
		getApplicationTrackRepository().getOwnerTrackStorage(publicId, ownerId),
	deleteRecord: (publicId, ownerId) =>
		getApplicationTrackRepository().deleteOwnerTrack(publicId, ownerId),
	quarantineFile: quarantineStoredAudioFile,
	deleteQuarantinedFile: deleteQuarantinedAudioFile,
	restoreQuarantinedFile: restoreQuarantinedAudioFile,
	now: () => new Date()
};

function updateFailure(
	status: 400 | 404 | 500,
	values: TrackMetadataFormValues,
	errors: TrackMetadataErrors
): Extract<UpdateTrackMetadataResult, { success: false }> {
	return { success: false, status, values, errors };
}

function deleteFailure(
	status: 404 | 500,
	message = status === 404 ? 'Track not found.' : GENERIC_TRACK_DELETE_ERROR
): Extract<DeleteTrackResult, { success: false }> {
	return { success: false, status, message };
}

async function restoreAfterDeleteFailure(
	file: QuarantinedAudioFile,
	dependencies: TrackManagementDependencies
): Promise<void> {
	try {
		await dependencies.restoreQuarantinedFile(file);
	} catch (error) {
		logTrackStorageError('Unable to restore quarantined audio after deletion failure.', error);
	}
}

export async function updateTrackMetadata(
	input: UpdateTrackMetadataInput,
	dependencies: TrackManagementDependencies = defaultDependencies
): Promise<UpdateTrackMetadataResult> {
	const validation = validateTrackMetadataFormData(input.formData);

	if (!validation.success) {
		return updateFailure(400, validation.values, validation.errors);
	}

	try {
		const track = await dependencies.updateMetadata(input.publicId, input.ownerId, {
			...validation.metadata,
			updatedAt: dependencies.now()
		});

		return track
			? { success: true }
			: updateFailure(404, validation.values, {});
	} catch (error) {
		logTrackStorageError('Unable to update owner-scoped track metadata.', error);
		return updateFailure(500, validation.values, {
			general: GENERIC_METADATA_UPDATE_ERROR
		});
	}
}

export async function deleteTrack(
	input: DeleteTrackInput,
	dependencies: TrackManagementDependencies = defaultDependencies
): Promise<DeleteTrackResult> {
	let trackFile: OwnedTrackFile | null;

	try {
		trackFile = await dependencies.findFile(input.publicId, input.ownerId);
	} catch (error) {
		logTrackStorageError('Unable to load owner-scoped track deletion data.', error);
		return deleteFailure(500);
	}

	if (!trackFile) {
		return deleteFailure(404);
	}

	let quarantine: QuarantineStoredAudioFileResult;

	try {
		quarantine = await dependencies.quarantineFile(trackFile.storedFilename);
	} catch (error) {
		logTrackStorageError('Unable to prepare stored audio for deletion.', error);
		return deleteFailure(500);
	}

	if (!quarantine.success) {
		return deleteFailure(500);
	}

	let deleted: boolean;

	try {
		deleted = await dependencies.deleteRecord(input.publicId, input.ownerId);
	} catch (error) {
		if (quarantine.state === 'quarantined') {
			await restoreAfterDeleteFailure(quarantine.file, dependencies);
		}

		logTrackStorageError('Owner-scoped track database deletion failed.', error);
		return deleteFailure(500);
	}

	if (quarantine.state === 'missing') {
		return deleted ? { success: true } : deleteFailure(404);
	}

	if (!deleted) {
		try {
			await dependencies.deleteQuarantinedFile(quarantine.file);
			return deleteFailure(404);
		} catch (error) {
			await restoreAfterDeleteFailure(quarantine.file, dependencies);
			logTrackStorageError('Unable to clean a concurrently deleted track file.', error);
			return deleteFailure(500);
		}
	}

	try {
		await dependencies.deleteQuarantinedFile(quarantine.file);
		return { success: true };
	} catch (error) {
		await restoreAfterDeleteFailure(quarantine.file, dependencies);
		logTrackStorageError('Unable to permanently remove quarantined audio.', error);
		return deleteFailure(500);
	}
}

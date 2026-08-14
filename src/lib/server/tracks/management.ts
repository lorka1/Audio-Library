import type { OwnerTrack } from '$lib/types';
import {
	coverImageFileHasValidContents,
	deleteQuarantinedCoverImageFile,
	deleteStoredCoverImageFile,
	quarantineStoredCoverImageFile,
	restoreQuarantinedCoverImageFile,
	saveCoverImageFile,
	type QuarantinedCoverImageFile,
	type QuarantineStoredCoverImageResult
} from './cover-files';
import {
	deleteQuarantinedAudioFile,
	quarantineStoredAudioFile,
	restoreQuarantinedAudioFile,
	type QuarantinedAudioFile,
	type QuarantineStoredAudioFileResult
} from './files';
import type { CoverImageExtension } from './media-formats';
import { logTrackStorageError } from './logging';
import {
	type OwnerTrackStorage,
	type UpdateOwnerTrackMetadataInput
} from './contract';
import { getApplicationTrackRepository } from './persistence';
import {
	validateTrackEditFormData,
	DEFAULT_COVER_IMAGE_MAX_SIZE_BYTES,
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
		metadata: UpdateOwnerTrackMetadataInput
	): Promise<OwnerTrack | null>;
	findFile(publicId: number, ownerId: string): Promise<OwnerTrackStorage | null>;
	saveCoverFile(
		file: File,
		extension: CoverImageExtension,
		maxFileSizeBytes: number
	): Promise<{ storedFilename: string; fileSizeBytes: number; mimeType: string }>;
	deleteCoverFile(storedFilename: string): Promise<void>;
	deleteRecord(publicId: number, ownerId: string): Promise<boolean>;
	quarantineFile(storedFilename: string): Promise<QuarantineStoredAudioFileResult>;
	quarantineCoverFile(storedFilename: string): Promise<QuarantineStoredCoverImageResult>;
	deleteQuarantinedFile(file: QuarantinedAudioFile): Promise<void>;
	deleteQuarantinedCoverFile(file: QuarantinedCoverImageFile): Promise<void>;
	restoreQuarantinedFile(file: QuarantinedAudioFile): Promise<void>;
	restoreQuarantinedCoverFile(file: QuarantinedCoverImageFile): Promise<void>;
	now(): Date;
}

export interface UpdateTrackMetadataInput {
	publicId: number;
	ownerId: string;
	formData: FormData;
	maxCoverImageSizeBytes?: number;
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
	updateMetadata: async (publicId, ownerId, metadata) =>
		(await getApplicationTrackRepository()).updateOwnerTrackMetadata(
			publicId,
			ownerId,
			metadata
		),
	findFile: async (publicId, ownerId) =>
		(await getApplicationTrackRepository()).getOwnerTrackStorage(publicId, ownerId),
	saveCoverFile: saveCoverImageFile,
	deleteCoverFile: deleteStoredCoverImageFile,
	deleteRecord: async (publicId, ownerId) =>
		(await getApplicationTrackRepository()).deleteOwnerTrack(publicId, ownerId),
	quarantineFile: quarantineStoredAudioFile,
	quarantineCoverFile: quarantineStoredCoverImageFile,
	deleteQuarantinedFile: deleteQuarantinedAudioFile,
	deleteQuarantinedCoverFile: deleteQuarantinedCoverImageFile,
	restoreQuarantinedFile: restoreQuarantinedAudioFile,
	restoreQuarantinedCoverFile: restoreQuarantinedCoverImageFile,
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

async function restoreCoverAfterDeleteFailure(
	file: QuarantinedCoverImageFile,
	dependencies: TrackManagementDependencies
): Promise<void> {
	try {
		await dependencies.restoreQuarantinedCoverFile(file);
	} catch (error) {
		logTrackStorageError(
			'Unable to restore a quarantined cover image after deletion failure.',
			error
		);
	}
}

async function removeNewCoverAfterUpdateFailure(
	storedFilename: string,
	dependencies: TrackManagementDependencies
): Promise<void> {
	try {
		await dependencies.deleteCoverFile(storedFilename);
	} catch (error) {
		logTrackStorageError(
			'Unable to remove a new cover image after metadata update failure.',
			error
		);
	}
}

async function cleanPreviousCoverAfterUpdate(
	storedFilename: string,
	dependencies: TrackManagementDependencies
): Promise<void> {
	let quarantine: QuarantineStoredCoverImageResult;
	try {
		quarantine = await dependencies.quarantineCoverFile(storedFilename);
	} catch (error) {
		logTrackStorageError(
			'Unable to prepare a replaced cover image for cleanup.',
			error
		);
		return;
	}

	if (!quarantine.success || quarantine.state === 'missing') {
		if (!quarantine.success) {
			logTrackStorageError(
				'Replaced cover image cleanup failed validation.',
				new Error('cover_cleanup_failed')
			);
		}
		return;
	}

	try {
		await dependencies.deleteQuarantinedCoverFile(quarantine.file);
	} catch (error) {
		await restoreCoverAfterDeleteFailure(quarantine.file, dependencies);
		logTrackStorageError(
			'Unable to permanently remove a replaced cover image.',
			error
		);
	}
}

export async function updateTrackMetadata(
	input: UpdateTrackMetadataInput,
	dependencies: TrackManagementDependencies = defaultDependencies
): Promise<UpdateTrackMetadataResult> {
	const validation = validateTrackEditFormData(
		input.formData,
		input.maxCoverImageSizeBytes ?? DEFAULT_COVER_IMAGE_MAX_SIZE_BYTES
	);

	if (!validation.success) {
		return updateFailure(400, validation.values, validation.errors);
	}

	if (validation.coverOperation.kind === 'replace') {
		try {
			const validContents = await coverImageFileHasValidContents(
				validation.coverOperation.coverImage.file,
				validation.coverOperation.coverImage.extension
			);
			if (!validContents) {
				return updateFailure(400, validation.values, {
					coverImage:
						'Cover image content does not match a supported JPEG, PNG, or WebP image.'
				});
			}
		} catch (error) {
			logTrackStorageError('Unable to validate a replacement cover image.', error);
			return updateFailure(500, validation.values, {
				general: GENERIC_METADATA_UPDATE_ERROR
			});
		}
	}

	let storage: OwnerTrackStorage | null = null;
	if (validation.coverOperation.kind !== 'retain') {
		try {
			storage = await dependencies.findFile(input.publicId, input.ownerId);
		} catch (error) {
			logTrackStorageError(
				'Unable to load owner-scoped cover image metadata.',
				error
			);
			return updateFailure(500, validation.values, {
				general: GENERIC_METADATA_UPDATE_ERROR
			});
		}
		if (!storage) return updateFailure(404, validation.values, {});
	}

	let newCover:
		| { storedFilename: string; fileSizeBytes: number; mimeType: string }
		| null = null;
	if (validation.coverOperation.kind === 'replace') {
		try {
			newCover = await dependencies.saveCoverFile(
				validation.coverOperation.coverImage.file,
				validation.coverOperation.coverImage.extension,
				input.maxCoverImageSizeBytes ??
					DEFAULT_COVER_IMAGE_MAX_SIZE_BYTES
			);
		} catch (error) {
			logTrackStorageError('Unable to store a replacement cover image.', error);
			return updateFailure(500, validation.values, {
				general: GENERIC_METADATA_UPDATE_ERROR
			});
		}
	}

	const coverUpdate =
		validation.coverOperation.kind === 'retain'
			? {}
			: validation.coverOperation.kind === 'remove'
				? { coverImage: null }
				: {
						coverImage: {
							storageKey: newCover!.storedFilename,
							mimeType: newCover!.mimeType,
							byteSize: newCover!.fileSizeBytes
						}
					};

	try {
		const track = await dependencies.updateMetadata(input.publicId, input.ownerId, {
			...validation.metadata,
			...coverUpdate,
			updatedAt: dependencies.now()
		});

		if (!track) {
			if (newCover) {
				await removeNewCoverAfterUpdateFailure(
					newCover.storedFilename,
					dependencies
				);
			}
			return updateFailure(404, validation.values, {});
		}
	} catch (error) {
		if (newCover) {
			await removeNewCoverAfterUpdateFailure(
				newCover.storedFilename,
				dependencies
			);
		}
		logTrackStorageError('Unable to update owner-scoped track metadata.', error);
		return updateFailure(500, validation.values, {
			general: GENERIC_METADATA_UPDATE_ERROR
		});
	}

	const previousCover = storage?.coverImage;
	if (
		validation.coverOperation.kind !== 'retain' &&
		previousCover &&
		previousCover.storageKey !== newCover?.storedFilename
	) {
		await cleanPreviousCoverAfterUpdate(
			previousCover.storageKey,
			dependencies
		);
	}

	return { success: true };
}

async function restoreDeletionQuarantines(
	audio: QuarantineStoredAudioFileResult,
	cover: QuarantineStoredCoverImageResult | null,
	dependencies: TrackManagementDependencies
): Promise<void> {
	if (cover?.success && cover.state === 'quarantined') {
		await restoreCoverAfterDeleteFailure(cover.file, dependencies);
	}
	if (audio.success && audio.state === 'quarantined') {
		await restoreAfterDeleteFailure(audio.file, dependencies);
	}
}

async function finalizeDeletionQuarantines(
	audio: QuarantineStoredAudioFileResult,
	cover: QuarantineStoredCoverImageResult | null,
	dependencies: TrackManagementDependencies
): Promise<boolean> {
	let success = true;

	if (audio.success && audio.state === 'quarantined') {
		try {
			await dependencies.deleteQuarantinedFile(audio.file);
		} catch (error) {
			success = false;
			await restoreAfterDeleteFailure(audio.file, dependencies);
			logTrackStorageError('Unable to permanently remove quarantined audio.', error);
		}
	}

	if (cover?.success && cover.state === 'quarantined') {
		try {
			await dependencies.deleteQuarantinedCoverFile(cover.file);
		} catch (error) {
			success = false;
			await restoreCoverAfterDeleteFailure(cover.file, dependencies);
			logTrackStorageError(
				'Unable to permanently remove a quarantined cover image.',
				error
			);
		}
	}

	return success;
}

export async function deleteTrack(
	input: DeleteTrackInput,
	dependencies: TrackManagementDependencies = defaultDependencies
): Promise<DeleteTrackResult> {
	let trackFile: OwnerTrackStorage | null;

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

	let coverQuarantine: QuarantineStoredCoverImageResult | null = null;
	if (trackFile.coverImage) {
		try {
			coverQuarantine = await dependencies.quarantineCoverFile(
				trackFile.coverImage.storageKey
			);
		} catch (error) {
			await restoreDeletionQuarantines(quarantine, null, dependencies);
			logTrackStorageError('Unable to prepare a stored cover image for deletion.', error);
			return deleteFailure(500);
		}

		if (!coverQuarantine.success) {
			await restoreDeletionQuarantines(quarantine, null, dependencies);
			return deleteFailure(500);
		}
	}

	let deleted: boolean;

	try {
		deleted = await dependencies.deleteRecord(input.publicId, input.ownerId);
	} catch (error) {
		await restoreDeletionQuarantines(
			quarantine,
			coverQuarantine,
			dependencies
		);
		logTrackStorageError('Owner-scoped track database deletion failed.', error);
		return deleteFailure(500);
	}

	const finalized = await finalizeDeletionQuarantines(
		quarantine,
		coverQuarantine,
		dependencies
	);
	if (!finalized) return deleteFailure(500);
	return deleted ? { success: true } : deleteFailure(404);
}

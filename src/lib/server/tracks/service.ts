import { randomUUID } from 'node:crypto';
import type { CreatedTrack, CreateTrackInput } from './contract';
import {
	coverImageFileHasValidContents,
	deleteStoredCoverImageFile,
	saveCoverImageFile,
	type CoverImageExtension
} from './cover-files';
import {
	deleteStoredAudioFile,
	saveAudioFile,
	type AudioExtension
} from './files';
import { logTrackStorageError } from './logging';
import {
	validateUploadFormData,
	hasSelectedCoverImage,
	DEFAULT_COVER_IMAGE_MAX_SIZE_BYTES,
	type UploadErrors,
	type UploadFormValues
} from './validation';
import { getApplicationTrackRepository } from './persistence';

export const GENERIC_UPLOAD_ERROR = 'Unable to upload the audio track. Please try again.';

interface StoredAudioFile {
	storedFilename: string;
	fileSizeBytes: number;
}

interface StoredCoverImageFile {
	storedFilename: string;
	fileSizeBytes: number;
	mimeType: string;
}

export interface TrackUploadDependencies {
	saveFile(file: File, extension: AudioExtension): Promise<StoredAudioFile>;
	deleteFile(storedFilename: string): Promise<void>;
	saveCoverFile(
		file: File,
		extension: CoverImageExtension,
		maxFileSizeBytes: number
	): Promise<StoredCoverImageFile>;
	deleteCoverFile(storedFilename: string): Promise<void>;
	insertTrack(input: CreateTrackInput): Promise<CreatedTrack>;
	generateId(): string;
	now(): Date;
}

export interface UploadTrackInput {
	ownerId: string;
	formData: FormData;
	maxFileSizeBytes: number;
	maxCoverImageSizeBytes?: number;
}

export type UploadTrackResult =
	| {
			success: true;
			track: CreatedTrack;
	  }
	| {
			success: false;
			status: 400 | 500;
			values: UploadFormValues;
			errors: UploadErrors;
			needsAudioFileReselection: true;
			needsCoverImageReselection: boolean;
	  };

const defaultDependencies: TrackUploadDependencies = {
	saveFile: saveAudioFile,
	deleteFile: deleteStoredAudioFile,
	saveCoverFile: saveCoverImageFile,
	deleteCoverFile: deleteStoredCoverImageFile,
	insertTrack: async (input) =>
		(await getApplicationTrackRepository()).createTrack(input),
	generateId: randomUUID,
	now: () => new Date()
};

function uploadFailure(
	status: 400 | 500,
	values: UploadFormValues,
	errors: UploadErrors,
	needsCoverImageReselection = false
): Extract<UploadTrackResult, { success: false }> {
	return {
		success: false,
		status,
		values,
		errors,
		needsAudioFileReselection: true,
		needsCoverImageReselection
	};
}

async function cleanNewUploadFiles(
	audioFile: StoredAudioFile | null,
	coverImage: StoredCoverImageFile | null,
	dependencies: TrackUploadDependencies
): Promise<void> {
	const cleanups: Promise<void>[] = [];
	if (audioFile) cleanups.push(dependencies.deleteFile(audioFile.storedFilename));
	if (coverImage) cleanups.push(dependencies.deleteCoverFile(coverImage.storedFilename));
	await Promise.allSettled(cleanups);
}

export async function uploadTrack(
	input: UploadTrackInput,
	dependencies: TrackUploadDependencies = defaultDependencies
): Promise<UploadTrackResult> {
	const needsCoverImageReselection = hasSelectedCoverImage(input.formData);
	const maxCoverImageSizeBytes =
		input.maxCoverImageSizeBytes ?? DEFAULT_COVER_IMAGE_MAX_SIZE_BYTES;
	const validation = validateUploadFormData(
		input.formData,
		input.maxFileSizeBytes,
		maxCoverImageSizeBytes
	);

	if (!validation.success) {
		return uploadFailure(
			400,
			validation.values,
			validation.errors,
			needsCoverImageReselection
		);
	}

	if (validation.coverImage) {
		try {
			const validContents = await coverImageFileHasValidContents(
				validation.coverImage.file,
				validation.coverImage.extension
			);
			if (!validContents) {
				return uploadFailure(
					400,
					validation.values,
					{
						coverImage:
							'Cover image content does not match a supported JPEG, PNG, or WebP image.'
					},
					true
				);
			}
		} catch (error) {
			logTrackStorageError('Unable to validate an uploaded cover image.', error);
			return uploadFailure(
				500,
				validation.values,
				{ general: GENERIC_UPLOAD_ERROR },
				true
			);
		}
	}

	let storedAudioFile: StoredAudioFile;

	try {
		storedAudioFile = await dependencies.saveFile(
			validation.audioFile.file,
			validation.audioFile.extension
		);
	} catch (error) {
		logTrackStorageError('Unable to store an uploaded audio file.', error);
		return uploadFailure(
			500,
			validation.values,
			{ general: GENERIC_UPLOAD_ERROR },
			needsCoverImageReselection
		);
	}

	let storedCoverImage: StoredCoverImageFile | null = null;
	if (validation.coverImage) {
		try {
			storedCoverImage = await dependencies.saveCoverFile(
				validation.coverImage.file,
				validation.coverImage.extension,
				maxCoverImageSizeBytes
			);
		} catch (error) {
			logTrackStorageError('Unable to store an uploaded cover image.', error);
			await cleanNewUploadFiles(storedAudioFile, null, dependencies);
			return uploadFailure(
				500,
				validation.values,
				{ general: GENERIC_UPLOAD_ERROR },
				true
			);
		}
	}

	try {
		const timestamp = dependencies.now();
		const track = await dependencies.insertTrack({
			id: dependencies.generateId(),
			ownerId: input.ownerId,
			title: validation.metadata.title,
			artist: validation.metadata.artist,
			bpm: validation.metadata.bpm,
			musicalKey: validation.metadata.musicalKey,
			genre: validation.metadata.genre,
			description: validation.metadata.description,
			originalFilename: validation.audioFile.originalFilename,
			storageKey: storedAudioFile.storedFilename,
			mimeType: validation.audioFile.mimeType,
			fileSizeBytes: storedAudioFile.fileSizeBytes,
			coverImage: storedCoverImage
				? {
						storageKey: storedCoverImage.storedFilename,
						mimeType: storedCoverImage.mimeType,
						byteSize: storedCoverImage.fileSizeBytes
					}
				: null,
			createdAt: timestamp,
			updatedAt: timestamp
		});

		return { success: true, track };
	} catch (error) {
		logTrackStorageError('Unable to create uploaded track metadata.', error);
		await cleanNewUploadFiles(storedAudioFile, storedCoverImage, dependencies);
		return uploadFailure(
			500,
			validation.values,
			{ general: GENERIC_UPLOAD_ERROR },
			needsCoverImageReselection
		);
	}
}

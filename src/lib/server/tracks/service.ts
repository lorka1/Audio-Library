import { randomUUID } from 'node:crypto';
import { createTrack, type CreatedTrack, type CreateTrackInput } from './repository';
import {
	deleteStoredAudioFile,
	saveAudioFile,
	type AudioExtension
} from './files';
import { logTrackStorageError } from './logging';
import {
	validateUploadFormData,
	type UploadErrors,
	type UploadFormValues
} from './validation';

export const GENERIC_UPLOAD_ERROR = 'Unable to upload the audio track. Please try again.';

interface StoredAudioFile {
	storedFilename: string;
	fileSizeBytes: number;
}

export interface TrackUploadDependencies {
	saveFile(file: File, extension: AudioExtension): Promise<StoredAudioFile>;
	deleteFile(storedFilename: string): Promise<void>;
	insertTrack(input: CreateTrackInput): Promise<CreatedTrack>;
	generateId(): string;
	now(): Date;
}

export interface UploadTrackInput {
	ownerId: string;
	formData: FormData;
	maxFileSizeBytes: number;
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
	  };

const defaultDependencies: TrackUploadDependencies = {
	saveFile: saveAudioFile,
	deleteFile: deleteStoredAudioFile,
	insertTrack: createTrack,
	generateId: randomUUID,
	now: () => new Date()
};

function uploadFailure(
	status: 400 | 500,
	values: UploadFormValues,
	errors: UploadErrors
): Extract<UploadTrackResult, { success: false }> {
	return {
		success: false,
		status,
		values,
		errors,
		needsAudioFileReselection: true
	};
}

export async function uploadTrack(
	input: UploadTrackInput,
	dependencies: TrackUploadDependencies = defaultDependencies
): Promise<UploadTrackResult> {
	const validation = validateUploadFormData(input.formData, input.maxFileSizeBytes);

	if (!validation.success) {
		return uploadFailure(400, validation.values, validation.errors);
	}

	let storedAudioFile: StoredAudioFile;

	try {
		storedAudioFile = await dependencies.saveFile(
			validation.audioFile.file,
			validation.audioFile.extension
		);
	} catch (error) {
		logTrackStorageError('Unable to store an uploaded audio file.', error);
		return uploadFailure(500, validation.values, { general: GENERIC_UPLOAD_ERROR });
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
			createdAt: timestamp,
			updatedAt: timestamp
		});

		return { success: true, track };
	} catch (error) {
		logTrackStorageError('Unable to create uploaded track metadata.', error);

		try {
			await dependencies.deleteFile(storedAudioFile.storedFilename);
		} catch {
			// The storage helper records only sanitized error metadata.
		}

		return uploadFailure(500, validation.values, { general: GENERIC_UPLOAD_ERROR });
	}
}

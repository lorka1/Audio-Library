import {
	BPM_MAX,
	BPM_MIN,
	MUSIC_GENRES,
	MUSICAL_KEYS,
	type MusicGenre,
	type MusicalKey
} from '../../constants/music.ts';
import {
	getValidatedAudioExtension,
	type AudioExtension
} from './media-formats.ts';
import {
	getValidatedCoverImageExtension,
	type CoverImageExtension
} from './media-formats.ts';

export const TRACK_TITLE_MAX_LENGTH = 120;
export const TRACK_DESCRIPTION_MAX_LENGTH = 2000;
export const ORIGINAL_FILENAME_MAX_LENGTH = 255;
export const DEFAULT_COVER_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024;
export { BPM_MAX, BPM_MIN };

const musicalKeySet = new Set<string>(MUSICAL_KEYS);
const musicGenreSet = new Set<string>(MUSIC_GENRES);
const INTEGER_PATTERN = /^(?:0|[1-9]\d*)$/;

export interface TrackMetadataFormValues {
	title: string;
	bpm: string;
	musicalKey: string;
	genre: string;
	description: string;
}

export type UploadFormValues = TrackMetadataFormValues;
export type TrackMetadataErrorField =
	| keyof TrackMetadataFormValues
	| 'coverImage'
	| 'general';
export type TrackMetadataErrors = Partial<Record<TrackMetadataErrorField, string>>;
export type UploadErrorField =
	| keyof TrackMetadataFormValues
	| 'audioFile'
	| 'coverImage'
	| 'general';
export type UploadErrors = Partial<Record<UploadErrorField, string>>;

export interface ValidatedTrackMetadata {
	title: string;
	bpm: number | null;
	musicalKey: MusicalKey | null;
	genre: MusicGenre | null;
	description: string | null;
}

export interface ValidatedAudioFile {
	file: File;
	extension: AudioExtension;
	originalFilename: string;
	mimeType: string;
}

export interface ValidatedCoverImageFile {
	file: File;
	extension: CoverImageExtension;
	mimeType: string;
}

export type CoverImageEditOperation =
	| { kind: 'retain' }
	| { kind: 'remove' }
	| { kind: 'replace'; coverImage: ValidatedCoverImageFile };

export type UploadValidationResult =
	| {
			success: true;
			values: UploadFormValues;
			metadata: ValidatedTrackMetadata;
			audioFile: ValidatedAudioFile;
			coverImage: ValidatedCoverImageFile | null;
	  }
	| {
			success: false;
			values: UploadFormValues;
			errors: UploadErrors;
	  };

export type TrackEditValidationResult =
	| {
			success: true;
			values: TrackMetadataFormValues;
			metadata: ValidatedTrackMetadata;
			coverOperation: CoverImageEditOperation;
	  }
	| {
			success: false;
			values: TrackMetadataFormValues;
			errors: TrackMetadataErrors;
	  };

export type TrackMetadataValidationResult =
	| {
			success: true;
			values: TrackMetadataFormValues;
			metadata: ValidatedTrackMetadata;
	  }
	| {
			success: false;
			values: TrackMetadataFormValues;
			errors: TrackMetadataErrors;
	  };

export interface FieldValidation<T> {
	value: T;
	error: string | null;
}

export function readUploadFormString(formData: FormData, field: string): string {
	const value = formData.get(field);
	return typeof value === 'string' ? value : '';
}

export function emptyTrackMetadataFormValues(): TrackMetadataFormValues {
	return {
		title: '',
		bpm: '',
		musicalKey: '',
		genre: '',
		description: ''
	};
}

export const emptyUploadFormValues = emptyTrackMetadataFormValues;

export function readTrackMetadataFormValues(
	formData: FormData
): TrackMetadataFormValues {
	return {
		title: readUploadFormString(formData, 'title').trim(),
		bpm: readUploadFormString(formData, 'bpm').trim(),
		musicalKey: readUploadFormString(formData, 'musicalKey').trim(),
		genre: readUploadFormString(formData, 'genre').trim(),
		description: readUploadFormString(formData, 'description').trim()
	};
}

export const readUploadFormValues = readTrackMetadataFormValues;

export function validateTitle(value: string): FieldValidation<string> {
	const title = value.trim();

	if (!title) {
		return { value: title, error: 'Title is required.' };
	}

	if (title.length > TRACK_TITLE_MAX_LENGTH) {
		return {
			value: title,
			error: `Title must be at most ${TRACK_TITLE_MAX_LENGTH} characters.`
		};
	}

	return { value: title, error: null };
}

export function validateBpm(value: string): FieldValidation<number | null> {
	const normalizedBpm = value.trim();

	if (!normalizedBpm) {
		return { value: null, error: null };
	}

	if (!INTEGER_PATTERN.test(normalizedBpm)) {
		return { value: null, error: 'BPM must be an integer.' };
	}

	const bpm = Number(normalizedBpm);

	if (!Number.isSafeInteger(bpm)) {
		return { value: null, error: 'BPM must be an integer.' };
	}

	if (bpm < BPM_MIN || bpm > BPM_MAX) {
		return { value: null, error: `BPM must be between ${BPM_MIN} and ${BPM_MAX}.` };
	}

	return { value: bpm, error: null };
}

export function validateMusicalKey(value: string): FieldValidation<MusicalKey | null> {
	const musicalKey = value.trim();

	if (!musicalKey) {
		return { value: null, error: null };
	}

	if (!musicalKeySet.has(musicalKey)) {
		return { value: null, error: 'Select a valid musical key.' };
	}

	return { value: musicalKey as MusicalKey, error: null };
}

export function validateGenre(value: string): FieldValidation<MusicGenre | null> {
	const genre = value.trim();

	if (!genre) {
		return { value: null, error: null };
	}

	if (!musicGenreSet.has(genre)) {
		return { value: null, error: 'Select a valid genre.' };
	}

	return { value: genre as MusicGenre, error: null };
}

export function validateDescription(value: string): FieldValidation<string | null> {
	const description = value.trim();

	if (!description) {
		return { value: null, error: null };
	}

	if (description.length > TRACK_DESCRIPTION_MAX_LENGTH) {
		return {
			value: null,
			error: `Description must be at most ${TRACK_DESCRIPTION_MAX_LENGTH} characters.`
		};
	}

	return { value: description, error: null };
}

function formatMegabytes(bytes: number): string {
	return new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(bytes / 1024 / 1024);
}

export function audioFileTooLargeMessage(maxFileSizeBytes: number): string {
	return `Audio file must not be larger than ${formatMegabytes(maxFileSizeBytes)} MB.`;
}

export function coverImageTooLargeMessage(maxFileSizeBytes: number): string {
	return `Cover image must not be larger than ${formatMegabytes(maxFileSizeBytes)} MB.`;
}

export function validateAudioFile(
	value: FormDataEntryValue | null,
	maxFileSizeBytes: number
): { value: ValidatedAudioFile | null; error: string | null } {
	if (!(value instanceof File) || !value.name.trim()) {
		return { value: null, error: 'Audio file is required.' };
	}

	if (value.name.length > ORIGINAL_FILENAME_MAX_LENGTH || value.name.includes('\0')) {
		return {
			value: null,
			error: `Audio filename must be at most ${ORIGINAL_FILENAME_MAX_LENGTH} characters.`
		};
	}

	if (value.size === 0) {
		return { value: null, error: 'Audio file must not be empty.' };
	}

	if (!Number.isSafeInteger(value.size) || value.size > maxFileSizeBytes) {
		return {
			value: null,
			error: audioFileTooLargeMessage(maxFileSizeBytes)
		};
	}

	const extension = getValidatedAudioExtension(value.name, value.type);

	if (!extension) {
		return {
			value: null,
			error: 'Unsupported audio format. Upload an MP3, WAV, or OGG file.'
		};
	}

	return {
		value: {
			file: value,
			extension,
			originalFilename: value.name,
			mimeType: value.type.trim().toLowerCase()
		},
		error: null
	};
}

export function validateCoverImageFile(
	value: FormDataEntryValue | null,
	maxFileSizeBytes: number
): { value: ValidatedCoverImageFile | null; error: string | null } {
	if (value === null || (value instanceof File && !value.name.trim() && value.size === 0)) {
		return { value: null, error: null };
	}

	if (!(value instanceof File) || !value.name.trim()) {
		return { value: null, error: 'Select a JPEG, PNG, or WebP cover image.' };
	}

	if (value.name.length > ORIGINAL_FILENAME_MAX_LENGTH || value.name.includes('\0')) {
		return {
			value: null,
			error: `Cover image filename must be at most ${ORIGINAL_FILENAME_MAX_LENGTH} characters.`
		};
	}

	if (value.size === 0) {
		return { value: null, error: 'Cover image must not be empty.' };
	}

	if (!Number.isSafeInteger(value.size) || value.size > maxFileSizeBytes) {
		return {
			value: null,
			error: coverImageTooLargeMessage(maxFileSizeBytes)
		};
	}

	const extension = getValidatedCoverImageExtension(value.name, value.type);
	if (!extension) {
		return {
			value: null,
			error: 'Unsupported cover image format. Upload a JPEG, PNG, or WebP image.'
		};
	}

	return {
		value: {
			file: value,
			extension,
			mimeType: value.type.trim().toLowerCase()
		},
		error: null
	};
}

export function validateTrackMetadataFormData(
	formData: FormData
): TrackMetadataValidationResult {
	const values = readTrackMetadataFormValues(formData);
	const title = validateTitle(values.title);
	const bpm = validateBpm(values.bpm);
	const musicalKey = validateMusicalKey(values.musicalKey);
	const genre = validateGenre(values.genre);
	const description = validateDescription(values.description);
	const errors: TrackMetadataErrors = {};

	if (title.error) errors.title = title.error;
	if (bpm.error) errors.bpm = bpm.error;
	if (musicalKey.error) errors.musicalKey = musicalKey.error;
	if (genre.error) errors.genre = genre.error;
	if (description.error) errors.description = description.error;

	if (Object.keys(errors).length > 0) {
		return { success: false, values, errors };
	}

	return {
		success: true,
		values,
		metadata: {
			title: title.value,
			bpm: bpm.value,
			musicalKey: musicalKey.value,
			genre: genre.value,
			description: description.value
		}
	};
}

export function validateUploadFormData(
	formData: FormData,
	maxFileSizeBytes: number,
	maxCoverImageSizeBytes = DEFAULT_COVER_IMAGE_MAX_SIZE_BYTES
): UploadValidationResult {
	const metadataValidation = validateTrackMetadataFormData(formData);
	const values = metadataValidation.values;
	const audioFile = validateAudioFile(formData.get('audioFile'), maxFileSizeBytes);
	const coverImage = validateCoverImageFile(
		formData.get('coverImage'),
		maxCoverImageSizeBytes
	);
	const errors: UploadErrors = metadataValidation.success
		? {}
		: { ...metadataValidation.errors };

	if (audioFile.error) errors.audioFile = audioFile.error;
	if (coverImage.error) errors.coverImage = coverImage.error;

	if (!metadataValidation.success || !audioFile.value || coverImage.error) {
		return { success: false, values, errors };
	}

	return {
		success: true,
		values,
		metadata: metadataValidation.metadata,
		audioFile: audioFile.value,
		coverImage: coverImage.value
	};
}

export function hasSelectedCoverImage(formData: FormData): boolean {
	const value = formData.get('coverImage');
	return value instanceof File && Boolean(value.name.trim());
}

export function hasRequestedCoverImageRemoval(formData: FormData): boolean {
	const value = formData.get('removeCoverImage');
	return value === '1' || value === 'on' || value === 'true';
}

export function validateTrackEditFormData(
	formData: FormData,
	maxCoverImageSizeBytes = DEFAULT_COVER_IMAGE_MAX_SIZE_BYTES
): TrackEditValidationResult {
	const metadataValidation = validateTrackMetadataFormData(formData);
	const values = metadataValidation.values;
	const coverImage = validateCoverImageFile(
		formData.get('coverImage'),
		maxCoverImageSizeBytes
	);
	const removeValue = formData.get('removeCoverImage');
	const removeCoverImage = hasRequestedCoverImageRemoval(formData);
	const invalidRemoveValue =
		removeValue !== null &&
		!removeCoverImage &&
		!(typeof removeValue === 'string' && removeValue.trim() === '');
	const errors: TrackMetadataErrors = metadataValidation.success
		? {}
		: { ...metadataValidation.errors };

	if (coverImage.error) errors.coverImage = coverImage.error;
	if (invalidRemoveValue) {
		errors.coverImage = 'Choose a valid cover image action.';
	}
	if (removeCoverImage && coverImage.value) {
		errors.coverImage =
			'Choose either a replacement cover image or removal, not both.';
	}

	if (
		!metadataValidation.success ||
		coverImage.error ||
		invalidRemoveValue ||
		(removeCoverImage && coverImage.value)
	) {
		return { success: false, values, errors };
	}

	return {
		success: true,
		values,
		metadata: metadataValidation.metadata,
		coverOperation: removeCoverImage
			? { kind: 'remove' }
			: coverImage.value
				? { kind: 'replace', coverImage: coverImage.value }
				: { kind: 'retain' }
	};
}

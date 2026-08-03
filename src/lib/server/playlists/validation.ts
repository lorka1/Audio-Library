import type { PlaylistInput } from './contract.ts';
import {
	DEFAULT_COVER_IMAGE_MAX_SIZE_BYTES,
	validateCoverImageFile,
	type ValidatedCoverImageFile
} from '../tracks/validation.ts';

export const PLAYLIST_NAME_MAX_LENGTH = 80;
export const PLAYLIST_DESCRIPTION_MAX_LENGTH = 500;
export const PLAYLIST_PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{20,40}$/;

export interface PlaylistFormValues {
	name: string;
	description: string;
	removeImage: boolean;
}

export interface PlaylistFormErrors {
	name?: string;
	description?: string;
	image?: string;
	general?: string;
}

export type PlaylistValidationResult =
	| {
			success: true;
			input: PlaylistInput;
			values: PlaylistFormValues;
			imageOperation: { kind: 'retain' } | { kind: 'remove' } | { kind: 'replace'; image: ValidatedCoverImageFile };
	  }
	| { success: false; errors: PlaylistFormErrors; values: PlaylistFormValues };

function formString(formData: FormData, name: string): string {
	const value = formData.get(name);
	return typeof value === 'string' ? value : '';
}

function visibleLength(value: string): number {
	return Array.from(value).length;
}

export function validatePlaylistFormData(
	formData: FormData,
	maxImageSizeBytes = DEFAULT_COVER_IMAGE_MAX_SIZE_BYTES,
	allowRemoval = false
): PlaylistValidationResult {
	const removeImage = formData.get('removeImage') === 'true';
	const values = {
		name: formString(formData, 'name').trim(),
		description: formString(formData, 'description').trim(),
		removeImage
	};
	const errors: PlaylistFormErrors = {};
	const image = validateCoverImageFile(formData.get('image'), maxImageSizeBytes);

	if (!values.name) {
		errors.name = 'Enter a playlist name.';
	} else if (visibleLength(values.name) > PLAYLIST_NAME_MAX_LENGTH) {
		errors.name = `Playlist names must be ${PLAYLIST_NAME_MAX_LENGTH} characters or fewer.`;
	}
	if (visibleLength(values.description) > PLAYLIST_DESCRIPTION_MAX_LENGTH) {
		errors.description = `Descriptions must be ${PLAYLIST_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
	}
	if (image.error) errors.image = image.error.replaceAll('cover image', 'playlist image').replaceAll('Cover image', 'Playlist image');
	if (removeImage && !allowRemoval) errors.image = 'Playlist image removal is not available while creating a playlist.';
	if (removeImage && image.value) errors.image = 'Choose either a replacement playlist image or removal, not both.';

	if (Object.keys(errors).length > 0) return { success: false, errors, values };
	return {
		success: true,
		values,
		input: {
			name: values.name,
			description: values.description || null
		},
		imageOperation: removeImage
			? { kind: 'remove' }
			: image.value
				? { kind: 'replace', image: image.value }
				: { kind: 'retain' }
	};
}

export function isValidPlaylistPublicId(value: string): boolean {
	return PLAYLIST_PUBLIC_ID_PATTERN.test(value);
}

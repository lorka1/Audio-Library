import type { PlaylistInput } from './contract';

export const PLAYLIST_NAME_MAX_LENGTH = 80;
export const PLAYLIST_DESCRIPTION_MAX_LENGTH = 500;
export const PLAYLIST_PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{20,40}$/;

export interface PlaylistFormValues {
	name: string;
	description: string;
}

export interface PlaylistFormErrors {
	name?: string;
	description?: string;
	general?: string;
}

export type PlaylistValidationResult =
	| { success: true; input: PlaylistInput; values: PlaylistFormValues }
	| { success: false; errors: PlaylistFormErrors; values: PlaylistFormValues };

function formString(formData: FormData, name: string): string {
	const value = formData.get(name);
	return typeof value === 'string' ? value : '';
}

function visibleLength(value: string): number {
	return Array.from(value).length;
}

export function validatePlaylistFormData(formData: FormData): PlaylistValidationResult {
	const values = {
		name: formString(formData, 'name').trim(),
		description: formString(formData, 'description').trim()
	};
	const errors: PlaylistFormErrors = {};

	if (!values.name) {
		errors.name = 'Enter a playlist name.';
	} else if (visibleLength(values.name) > PLAYLIST_NAME_MAX_LENGTH) {
		errors.name = `Playlist names must be ${PLAYLIST_NAME_MAX_LENGTH} characters or fewer.`;
	}
	if (visibleLength(values.description) > PLAYLIST_DESCRIPTION_MAX_LENGTH) {
		errors.description = `Descriptions must be ${PLAYLIST_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
	}

	if (Object.keys(errors).length > 0) return { success: false, errors, values };
	return {
		success: true,
		values,
		input: {
			name: values.name,
			description: values.description || null
		}
	};
}

export function isValidPlaylistPublicId(value: string): boolean {
	return PLAYLIST_PUBLIC_ID_PATTERN.test(value);
}

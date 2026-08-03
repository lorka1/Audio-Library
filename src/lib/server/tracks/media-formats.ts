import { extname } from 'node:path';

export const AUDIO_FORMATS = {
	'.mp3': ['audio/mpeg'],
	'.wav': ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'],
	'.ogg': ['audio/ogg']
} as const;

export type AudioExtension = keyof typeof AUDIO_FORMATS;

export const COVER_IMAGE_FORMATS = {
	'.jpg': ['image/jpeg'],
	'.jpeg': ['image/jpeg'],
	'.png': ['image/png'],
	'.webp': ['image/webp']
} as const;

export type CoverImageExtension = keyof typeof COVER_IMAGE_FORMATS;
export type CoverImageMimeType =
	(typeof COVER_IMAGE_FORMATS)[CoverImageExtension][number];

export function normalizeAudioExtension(extension: string): AudioExtension | null {
	const normalizedExtension = extension.trim().toLowerCase();
	return Object.prototype.hasOwnProperty.call(AUDIO_FORMATS, normalizedExtension)
		? (normalizedExtension as AudioExtension)
		: null;
}

export function isAllowedAudioFormat(extension: string, mimeType: string): boolean {
	const normalizedExtension = normalizeAudioExtension(extension);
	if (!normalizedExtension) return false;
	const normalizedMimeType = mimeType.trim().toLowerCase();
	return AUDIO_FORMATS[normalizedExtension].some(
		(allowedMimeType) => allowedMimeType === normalizedMimeType
	);
}

export function getValidatedAudioExtension(
	originalFilename: string,
	mimeType: string
): AudioExtension | null {
	const extension = normalizeAudioExtension(extname(originalFilename));
	return extension && isAllowedAudioFormat(extension, mimeType) ? extension : null;
}

export function normalizeCoverImageExtension(
	extension: string
): CoverImageExtension | null {
	const normalizedExtension = extension.trim().toLowerCase();
	return Object.prototype.hasOwnProperty.call(COVER_IMAGE_FORMATS, normalizedExtension)
		? (normalizedExtension as CoverImageExtension)
		: null;
}

export function isAllowedCoverImageFormat(
	extension: string,
	mimeType: string
): boolean {
	const normalizedExtension = normalizeCoverImageExtension(extension);
	if (!normalizedExtension) return false;
	const normalizedMimeType = mimeType.trim().toLowerCase();
	return COVER_IMAGE_FORMATS[normalizedExtension].some(
		(allowedMimeType) => allowedMimeType === normalizedMimeType
	);
}

export function getValidatedCoverImageExtension(
	originalFilename: string,
	mimeType: string
): CoverImageExtension | null {
	const extension = normalizeCoverImageExtension(extname(originalFilename));
	return extension && isAllowedCoverImageFormat(extension, mimeType)
		? extension
		: null;
}

export function getSafeCoverImageResponseMimeType(
	storedFilename: string,
	mimeType: string
): CoverImageMimeType | null {
	return getValidatedCoverImageExtension(storedFilename, mimeType)
		? (mimeType.trim().toLowerCase() as CoverImageMimeType)
		: null;
}

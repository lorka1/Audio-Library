import { randomUUID } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { serverConfig } from '$lib/server/config';
import { logTrackStorageError } from './logging';

export const AUDIO_FORMATS = {
	'.mp3': ['audio/mpeg'],
	'.wav': ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'],
	'.ogg': ['audio/ogg']
} as const;

export type AudioExtension = keyof typeof AUDIO_FORMATS;

const UUID_V4_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORED_FILENAME_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:mp3|wav|ogg)$/;

function resolveStorageRoot(root: string): string {
	if (!root.trim()) {
		throw new Error('The audio storage root must not be empty.');
	}

	return resolve(root);
}

function readErrorCode(error: unknown): string | number | undefined {
	if (typeof error !== 'object' || error === null || !('code' in error)) {
		return undefined;
	}

	const code = (error as { code?: unknown }).code;
	return typeof code === 'string' || typeof code === 'number' ? code : undefined;
}

export function normalizeAudioExtension(extension: string): AudioExtension | null {
	const normalizedExtension = extension.trim().toLowerCase();

	return Object.prototype.hasOwnProperty.call(AUDIO_FORMATS, normalizedExtension)
		? (normalizedExtension as AudioExtension)
		: null;
}

export function isAllowedAudioFormat(extension: string, mimeType: string): boolean {
	const normalizedExtension = normalizeAudioExtension(extension);

	if (!normalizedExtension) {
		return false;
	}

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

export function generateStoredFilename(extension: string, uuid: string = randomUUID()): string {
	const normalizedExtension = normalizeAudioExtension(extension);
	const normalizedUuid = uuid.trim().toLowerCase();

	if (!normalizedExtension) {
		throw new Error('Unsupported audio file extension.');
	}

	if (!UUID_V4_PATTERN.test(normalizedUuid)) {
		throw new Error('A valid version 4 UUID is required for the stored filename.');
	}

	return `${normalizedUuid}${normalizedExtension}`;
}

export function resolveStorageFilePath(root: string, storedFilename: string): string {
	if (!STORED_FILENAME_PATTERN.test(storedFilename)) {
		throw new Error('Invalid stored audio filename.');
	}

	const storageRoot = resolveStorageRoot(root);
	const filePath = resolve(storageRoot, storedFilename);
	const pathWithinRoot = relative(storageRoot, filePath);

	if (
		pathWithinRoot === '' ||
		pathWithinRoot === '..' ||
		pathWithinRoot.startsWith(`..${sep}`) ||
		isAbsolute(pathWithinRoot)
	) {
		throw new Error('The stored audio path must remain inside the storage directory.');
	}

	return filePath;
}

export async function ensureAudioStorageDirectory(
	root = serverConfig.audioStoragePath
): Promise<string> {
	const storageRoot = resolveStorageRoot(root);
	await mkdir(storageRoot, { recursive: true });
	return storageRoot;
}

export async function saveAudioFile(
	file: File,
	extension: AudioExtension,
	root = serverConfig.audioStoragePath
): Promise<{ storedFilename: string; fileSizeBytes: number }> {
	if (!(file instanceof File)) {
		throw new Error('A valid audio File is required.');
	}

	if (!isAllowedAudioFormat(extension, file.type)) {
		throw new Error('The audio extension and MIME type do not match.');
	}

	if (!Number.isSafeInteger(file.size) || file.size <= 0) {
		throw new Error('The audio file must not be empty.');
	}

	const arrayBuffer = await file.arrayBuffer();
	const buffer = Buffer.from(arrayBuffer);

	if (buffer.byteLength !== file.size) {
		throw new Error('The audio file size changed while it was being read.');
	}

	const storageRoot = await ensureAudioStorageDirectory(root);
	const storedFilename = generateStoredFilename(extension);
	const filePath = resolveStorageFilePath(storageRoot, storedFilename);
	let fileHandle: Awaited<ReturnType<typeof open>> | undefined;
	let ownsFile = false;

	try {
		fileHandle = await open(filePath, 'wx', 0o600);
		ownsFile = true;
		await fileHandle.writeFile(buffer);
		await fileHandle.close();
		fileHandle = undefined;

		return {
			storedFilename,
			fileSizeBytes: buffer.byteLength
		};
	} catch (error) {
		if (fileHandle) {
			try {
				await fileHandle.close();
			} catch (closeError) {
				logTrackStorageError('Unable to close an incomplete audio file.', closeError);
			}
		}

		if (ownsFile) {
			try {
				await unlink(filePath);
			} catch (cleanupError) {
				if (readErrorCode(cleanupError) !== 'ENOENT') {
					logTrackStorageError('Unable to remove an incomplete audio file.', cleanupError);
				}
			}
		}

		throw error;
	}
}

export async function deleteStoredAudioFile(
	storedFilename: string,
	root = serverConfig.audioStoragePath
): Promise<void> {
	const filePath = resolveStorageFilePath(root, storedFilename);

	try {
		await unlink(filePath);
	} catch (error) {
		if (readErrorCode(error) === 'ENOENT') {
			return;
		}

		logTrackStorageError('Unable to delete a stored audio file.', error);
		throw error;
	}
}

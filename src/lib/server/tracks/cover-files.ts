import { randomUUID } from 'node:crypto';
import {
	lstat,
	mkdir,
	open,
	realpath,
	rename,
	unlink
} from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { getServerConfig } from '$lib/server/config';
import { logTrackStorageError } from './logging';
import {
	getSafeCoverImageResponseMimeType,
	getValidatedCoverImageExtension,
	normalizeCoverImageExtension,
	type CoverImageExtension,
	type CoverImageMimeType
} from './media-formats.ts';
export {
	COVER_IMAGE_FORMATS,
	getSafeCoverImageResponseMimeType,
	getValidatedCoverImageExtension,
	isAllowedCoverImageFormat,
	normalizeCoverImageExtension,
	type CoverImageExtension,
	type CoverImageMimeType
} from './media-formats.ts';

const UUID_V4_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORED_COVER_IMAGE_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|jpeg|png|webp)$/;

export interface QuarantinedCoverImageFile {
	originalPath: string;
	quarantinePath: string;
}

export type QuarantineStoredCoverImageResult =
	| {
			success: true;
			state: 'missing';
	  }
	| {
			success: true;
			state: 'quarantined';
			file: QuarantinedCoverImageFile;
	  }
	| {
			success: false;
			reason: 'unsafe' | 'not-file' | 'unavailable';
	  };

export type ReadStoredCoverImageResult =
	| {
			success: true;
			file: {
				bytes: Uint8Array;
				fileSizeBytes: number;
				mimeType: CoverImageMimeType;
			};
	  }
	| {
			success: false;
			reason: 'missing' | 'not-file' | 'invalid' | 'unavailable';
	  };

function resolveCoverStorageRoot(root: string): string {
	if (!root.trim()) {
		throw new Error('The cover image storage root must not be empty.');
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

function isContainedPath(root: string, path: string): boolean {
	const pathWithinRoot = relative(root, path);
	return (
		pathWithinRoot !== '' &&
		pathWithinRoot !== '..' &&
		!pathWithinRoot.startsWith(`..${sep}`) &&
		!isAbsolute(pathWithinRoot)
	);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(start, start + length));
}

export function hasValidCoverImageSignature(
	bytes: Uint8Array,
	extension: CoverImageExtension
): boolean {
	if (extension === '.jpg' || extension === '.jpeg') {
		return (
			bytes.length >= 4 &&
			bytes[0] === 0xff &&
			bytes[1] === 0xd8 &&
			bytes[2] === 0xff &&
			bytes[bytes.length - 2] === 0xff &&
			bytes[bytes.length - 1] === 0xd9
		);
	}

	if (extension === '.png') {
		const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
		return (
			bytes.length >= 24 &&
			signature.every((value, index) => bytes[index] === value) &&
			ascii(bytes, 12, 4) === 'IHDR'
		);
	}

	if (bytes.length < 16 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
		return false;
	}

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const declaredSize = view.getUint32(4, true) + 8;
	const chunk = ascii(bytes, 12, 4);
	return (
		declaredSize === bytes.length &&
		(chunk === 'VP8 ' || chunk === 'VP8L' || chunk === 'VP8X')
	);
}

export async function coverImageFileHasValidContents(
	file: File,
	extension: CoverImageExtension
): Promise<boolean> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	return (
		bytes.byteLength === file.size &&
		hasValidCoverImageSignature(bytes, extension)
	);
}

export function generateStoredCoverImageFilename(
	extension: string,
	uuid: string = randomUUID()
): string {
	const normalizedExtension = normalizeCoverImageExtension(extension);
	const normalizedUuid = uuid.trim().toLowerCase();

	if (!normalizedExtension) {
		throw new Error('Unsupported cover image extension.');
	}

	if (!UUID_V4_PATTERN.test(normalizedUuid)) {
		throw new Error('A valid version 4 UUID is required for the stored cover filename.');
	}

	return `${normalizedUuid}${normalizedExtension}`;
}

export function resolveCoverImageFilePath(
	root: string,
	storedFilename: string
): string {
	if (!STORED_COVER_IMAGE_PATTERN.test(storedFilename)) {
		throw new Error('Invalid stored cover image filename.');
	}

	const storageRoot = resolveCoverStorageRoot(root);
	const filePath = resolve(storageRoot, storedFilename);
	if (!isContainedPath(storageRoot, filePath)) {
		throw new Error('The stored cover image path must remain inside the storage directory.');
	}

	return filePath;
}

export async function ensureCoverImageStorageDirectory(
	root = getServerConfig().coverImageStoragePath
): Promise<string> {
	const storageRoot = resolveCoverStorageRoot(root);
	await mkdir(storageRoot, { recursive: true });
	return storageRoot;
}

export async function saveCoverImageFile(
	file: File,
	extension: CoverImageExtension,
	maxFileSizeBytes = getServerConfig().coverImageMaxSizeBytes,
	root = getServerConfig().coverImageStoragePath
): Promise<{
	storedFilename: string;
	fileSizeBytes: number;
	mimeType: CoverImageMimeType;
}> {
	if (!(file instanceof File)) {
		throw new Error('A valid cover image File is required.');
	}

	const validatedExtension = getValidatedCoverImageExtension(file.name, file.type);
	if (validatedExtension !== extension) {
		throw new Error('The cover image extension and MIME type do not match.');
	}

	if (
		!Number.isSafeInteger(file.size) ||
		file.size <= 0 ||
		file.size > maxFileSizeBytes
	) {
		throw new Error('The cover image file size is invalid.');
	}

	const arrayBuffer = await file.arrayBuffer();
	const buffer = Buffer.from(arrayBuffer);
	if (
		buffer.byteLength !== file.size ||
		!hasValidCoverImageSignature(buffer, extension)
	) {
		throw new Error('The cover image content is invalid.');
	}

	const storageRoot = await ensureCoverImageStorageDirectory(root);
	const storedFilename = generateStoredCoverImageFilename(extension);
	const filePath = resolveCoverImageFilePath(storageRoot, storedFilename);
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
			fileSizeBytes: buffer.byteLength,
			mimeType: file.type.trim().toLowerCase() as CoverImageMimeType
		};
	} catch (error) {
		if (fileHandle) {
			try {
				await fileHandle.close();
			} catch (closeError) {
				logTrackStorageError(
					'Unable to close an incomplete cover image file.',
					closeError
				);
			}
		}

		if (ownsFile) {
			try {
				await unlink(filePath);
			} catch (cleanupError) {
				if (readErrorCode(cleanupError) !== 'ENOENT') {
					logTrackStorageError(
						'Unable to remove an incomplete cover image file.',
						cleanupError
					);
				}
			}
		}

		throw error;
	}
}

export async function deleteStoredCoverImageFile(
	storedFilename: string,
	root = getServerConfig().coverImageStoragePath
): Promise<void> {
	const filePath = resolveCoverImageFilePath(root, storedFilename);

	try {
		await unlink(filePath);
	} catch (error) {
		if (readErrorCode(error) === 'ENOENT') return;
		logTrackStorageError('Unable to delete a stored cover image.', error);
		throw error;
	}
}

export async function quarantineStoredCoverImageFile(
	storedFilename: string,
	root = getServerConfig().coverImageStoragePath
): Promise<QuarantineStoredCoverImageResult> {
	let filePath: string;

	try {
		filePath = resolveCoverImageFilePath(root, storedFilename);
	} catch (error) {
		logTrackStorageError('Stored cover image deletion path validation failed.', error);
		return { success: false, reason: 'unsafe' };
	}

	let canonicalRoot: string;

	try {
		const linkStat = await lstat(filePath);
		if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
			return { success: false, reason: 'not-file' };
		}

		[canonicalRoot, filePath] = await Promise.all([
			realpath(resolveCoverStorageRoot(root)),
			realpath(filePath)
		]);
		if (!isContainedPath(canonicalRoot, filePath)) {
			return { success: false, reason: 'unsafe' };
		}
	} catch (error) {
		const code = readErrorCode(error);
		if (code === 'ENOENT' || code === 'ENOTDIR') {
			return { success: true, state: 'missing' };
		}
		logTrackStorageError('Unable to verify a stored cover image before deletion.', error);
		return { success: false, reason: 'unavailable' };
	}

	const quarantinePath = resolve(canonicalRoot, `.delete-${randomUUID()}.tmp`);
	if (!isContainedPath(canonicalRoot, quarantinePath)) {
		return { success: false, reason: 'unsafe' };
	}

	try {
		await rename(filePath, quarantinePath);
		return {
			success: true,
			state: 'quarantined',
			file: { originalPath: filePath, quarantinePath }
		};
	} catch (error) {
		const code = readErrorCode(error);
		if (code === 'ENOENT' || code === 'ENOTDIR') {
			return { success: true, state: 'missing' };
		}
		logTrackStorageError('Unable to quarantine a stored cover image.', error);
		return { success: false, reason: 'unavailable' };
	}
}

export async function restoreQuarantinedCoverImageFile(
	file: QuarantinedCoverImageFile
): Promise<void> {
	await rename(file.quarantinePath, file.originalPath);
}

export async function deleteQuarantinedCoverImageFile(
	file: QuarantinedCoverImageFile
): Promise<void> {
	try {
		await unlink(file.quarantinePath);
	} catch (error) {
		if (readErrorCode(error) === 'ENOENT') return;
		throw error;
	}
}

export async function readStoredCoverImageFile(
	storedFilename: string,
	mimeType: string,
	expectedFileSizeBytes: number,
	maxFileSizeBytes = getServerConfig().coverImageMaxSizeBytes,
	root = getServerConfig().coverImageStoragePath
): Promise<ReadStoredCoverImageResult> {
	const safeMimeType = getSafeCoverImageResponseMimeType(storedFilename, mimeType);
	if (!safeMimeType) return { success: false, reason: 'invalid' };

	let filePath: string;
	try {
		filePath = resolveCoverImageFilePath(root, storedFilename);
	} catch {
		return { success: false, reason: 'missing' };
	}

	try {
		const linkStat = await lstat(filePath);
		if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
			return { success: false, reason: 'not-file' };
		}

		const canonicalRoot = await realpath(resolveCoverStorageRoot(root));
		filePath = await realpath(filePath);
		if (!isContainedPath(canonicalRoot, filePath)) {
			return { success: false, reason: 'not-file' };
		}
	} catch (error) {
		const code = readErrorCode(error);
		if (code === 'ENOENT' || code === 'ENOTDIR') {
			return { success: false, reason: 'missing' };
		}
		logTrackStorageError('Unable to verify a stored cover image.', error);
		return { success: false, reason: 'unavailable' };
	}

	let fileHandle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		fileHandle = await open(filePath, 'r');
		const fileStat = await fileHandle.stat();
		if (
			!fileStat.isFile() ||
			!Number.isSafeInteger(fileStat.size) ||
			fileStat.size <= 0 ||
			fileStat.size > maxFileSizeBytes ||
			fileStat.size !== expectedFileSizeBytes
		) {
			return { success: false, reason: 'invalid' };
		}

		const buffer = await fileHandle.readFile();
		const extension = normalizeCoverImageExtension(extname(storedFilename));
		if (
			buffer.byteLength !== fileStat.size ||
			!extension ||
			!hasValidCoverImageSignature(buffer, extension)
		) {
			return { success: false, reason: 'invalid' };
		}

		return {
			success: true,
			file: {
				bytes: buffer,
				fileSizeBytes: buffer.byteLength,
				mimeType: safeMimeType
			}
		};
	} catch (error) {
		const code = readErrorCode(error);
		if (code === 'ENOENT' || code === 'ENOTDIR') {
			return { success: false, reason: 'missing' };
		}
		logTrackStorageError('Unable to read a stored cover image.', error);
		return { success: false, reason: 'unavailable' };
	} finally {
		if (fileHandle) {
			try {
				await fileHandle.close();
			} catch (error) {
				logTrackStorageError('Unable to close a stored cover image.', error);
			}
		}
	}
}

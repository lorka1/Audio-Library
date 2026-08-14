import { getServerConfig } from '../config';
import {
	deleteQuarantinedCoverImageFile,
	deleteStoredCoverImageFile,
	quarantineStoredCoverImageFile,
	readStoredCoverImageFile,
	restoreQuarantinedCoverImageFile,
	saveCoverImageFile,
	type QuarantinedCoverImageFile,
	type QuarantineStoredCoverImageResult
} from '../tracks/cover-files';
import type { CoverImageExtension } from '../tracks/media-formats';

export type PlaylistImageExtension = CoverImageExtension;
export type QuarantinedPlaylistImageFile = QuarantinedCoverImageFile;
export type QuarantineStoredPlaylistImageResult = QuarantineStoredCoverImageResult;

export function savePlaylistImageFile(
	file: File,
	extension: PlaylistImageExtension,
	maxFileSizeBytes = getServerConfig().playlistImageMaxSizeBytes,
	root = getServerConfig().playlistImageStoragePath
) {
	return saveCoverImageFile(file, extension, maxFileSizeBytes, root);
}

export function deleteStoredPlaylistImageFile(
	storageKey: string,
	root = getServerConfig().playlistImageStoragePath
) {
	return deleteStoredCoverImageFile(storageKey, root);
}

export function quarantineStoredPlaylistImageFile(
	storageKey: string,
	root = getServerConfig().playlistImageStoragePath
) {
	return quarantineStoredCoverImageFile(storageKey, root);
}

export const restoreQuarantinedPlaylistImageFile = restoreQuarantinedCoverImageFile;
export const deleteQuarantinedPlaylistImageFile = deleteQuarantinedCoverImageFile;

export function readStoredPlaylistImageFile(
	storageKey: string,
	mimeType: string,
	expectedFileSizeBytes: number,
	maxFileSizeBytes = getServerConfig().playlistImageMaxSizeBytes,
	root = getServerConfig().playlistImageStoragePath
) {
	return readStoredCoverImageFile(
		storageKey,
		mimeType,
		expectedFileSizeBytes,
		maxFileSizeBytes,
		root
	);
}

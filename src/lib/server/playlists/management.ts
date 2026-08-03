import { coverImageFileHasValidContents } from '../tracks/cover-files';
import { safeErrorFields, writeSafeLog } from '../operational/logging';
import type { PlaylistSummary } from '$lib/types';
import type { OwnerPlaylistImageStorage, PlaylistInput } from './contract';
import {
	deleteQuarantinedPlaylistImageFile,
	deleteStoredPlaylistImageFile,
	quarantineStoredPlaylistImageFile,
	restoreQuarantinedPlaylistImageFile,
	savePlaylistImageFile,
	type QuarantinedPlaylistImageFile,
	type QuarantineStoredPlaylistImageResult
} from './image-files';
import { getApplicationPlaylistRepository } from './persistence';
import {
	validatePlaylistFormData,
	type PlaylistFormErrors,
	type PlaylistFormValues
} from './validation';

export const GENERIC_PLAYLIST_CREATE_ERROR = 'Unable to create the playlist. Please try again.';
export const GENERIC_PLAYLIST_UPDATE_ERROR = 'Unable to update the playlist. Please try again.';
export const GENERIC_PLAYLIST_DELETE_ERROR = 'Unable to delete the playlist. Please try again.';

export interface PlaylistManagementDependencies {
	create(ownerId: string, input: PlaylistInput): Promise<PlaylistSummary>;
	update(ownerId: string, publicId: string, input: PlaylistInput): Promise<PlaylistSummary | null>;
	remove(ownerId: string, publicId: string): Promise<boolean>;
	findStorage(ownerId: string, publicId: string): Promise<OwnerPlaylistImageStorage | null>;
	saveImage: typeof savePlaylistImageFile;
	deleteImage: typeof deleteStoredPlaylistImageFile;
	quarantineImage: typeof quarantineStoredPlaylistImageFile;
	restoreImage: typeof restoreQuarantinedPlaylistImageFile;
	deleteQuarantinedImage: typeof deleteQuarantinedPlaylistImageFile;
}

const defaultDependencies: PlaylistManagementDependencies = {
	create: async (ownerId, input) => (await getApplicationPlaylistRepository()).createPlaylist(ownerId, input),
	update: async (ownerId, publicId, input) => (await getApplicationPlaylistRepository()).updatePlaylistForOwner(ownerId, publicId, input),
	remove: async (ownerId, publicId) => (await getApplicationPlaylistRepository()).deletePlaylistForOwner(ownerId, publicId),
	findStorage: async (ownerId, publicId) => (await getApplicationPlaylistRepository()).findPlaylistImageStorageForOwner(ownerId, publicId),
	saveImage: savePlaylistImageFile,
	deleteImage: deleteStoredPlaylistImageFile,
	quarantineImage: quarantineStoredPlaylistImageFile,
	restoreImage: restoreQuarantinedPlaylistImageFile,
	deleteQuarantinedImage: deleteQuarantinedPlaylistImageFile
};

type FailureStatus = 400 | 404 | 500;
export type PlaylistMutationResult =
	| { success: true }
	| { success: false; status: FailureStatus; values: PlaylistFormValues; errors: PlaylistFormErrors };
export type PlaylistDeletionResult =
	| { success: true }
	| { success: false; status: 404 | 500; message: string };

function log(message: string, error: unknown): void {
	writeSafeLog({ severity: 'error', category: 'filesystem', ...safeErrorFields(error), code: message });
}

async function validateContents(
	operation: ReturnType<typeof validatePlaylistFormData>
): Promise<string | null> {
	if (!operation.success || operation.imageOperation.kind !== 'replace') return null;
	try {
		return await coverImageFileHasValidContents(
			operation.imageOperation.image.file,
			operation.imageOperation.image.extension
		)
			? null
			: 'Playlist image content does not match a supported JPEG, PNG, or WebP image.';
	} catch (error) {
		log('playlist_image_validation_failed', error);
		return 'Unable to validate the playlist image. Please try again.';
	}
}

async function removeNewImage(storageKey: string, dependencies: PlaylistManagementDependencies): Promise<void> {
	try { await dependencies.deleteImage(storageKey); } catch (error) { log('playlist_image_rollback_failed', error); }
}

async function cleanPreviousImage(storageKey: string, dependencies: PlaylistManagementDependencies): Promise<void> {
	let quarantine: QuarantineStoredPlaylistImageResult;
	try { quarantine = await dependencies.quarantineImage(storageKey); }
	catch (error) { log('playlist_image_cleanup_failed', error); return; }
	if (!quarantine.success || quarantine.state === 'missing') return;
	try { await dependencies.deleteQuarantinedImage(quarantine.file); }
	catch (error) {
		try { await dependencies.restoreImage(quarantine.file); } catch (restoreError) { log('playlist_image_cleanup_restore_failed', restoreError); }
		log('playlist_image_cleanup_failed', error);
	}
}

export async function createPlaylist(
	ownerId: string,
	formData: FormData,
	maxImageSizeBytes: number,
	dependencies: PlaylistManagementDependencies = defaultDependencies
): Promise<PlaylistMutationResult> {
	const validation = validatePlaylistFormData(formData, maxImageSizeBytes);
	if (!validation.success) return { success: false, status: 400, values: validation.values, errors: validation.errors };
	const contentError = await validateContents(validation);
	if (contentError) return { success: false, status: 400, values: validation.values, errors: { image: contentError } };
	let stored: Awaited<ReturnType<typeof savePlaylistImageFile>> | null = null;
	try {
		if (validation.imageOperation.kind === 'replace') {
			stored = await dependencies.saveImage(validation.imageOperation.image.file, validation.imageOperation.image.extension, maxImageSizeBytes);
		}
		await dependencies.create(ownerId, {
			...validation.input,
			image: stored ? { storageKey: stored.storedFilename, mimeType: stored.mimeType, byteSize: stored.fileSizeBytes } : null
		});
		return { success: true };
	} catch (error) {
		if (stored) await removeNewImage(stored.storedFilename, dependencies);
		log('playlist_create_failed', error);
		return { success: false, status: 500, values: validation.values, errors: { general: GENERIC_PLAYLIST_CREATE_ERROR } };
	}
}

export async function updatePlaylist(
	ownerId: string,
	publicId: string,
	formData: FormData,
	maxImageSizeBytes: number,
	dependencies: PlaylistManagementDependencies = defaultDependencies
): Promise<PlaylistMutationResult> {
	const validation = validatePlaylistFormData(formData, maxImageSizeBytes, true);
	if (!validation.success) return { success: false, status: 400, values: validation.values, errors: validation.errors };
	const contentError = await validateContents(validation);
	if (contentError) return { success: false, status: 400, values: validation.values, errors: { image: contentError } };
	let previous: OwnerPlaylistImageStorage | null = null;
	if (validation.imageOperation.kind !== 'retain') {
		try { previous = await dependencies.findStorage(ownerId, publicId); }
		catch (error) { log('playlist_image_lookup_failed', error); return { success: false, status: 500, values: validation.values, errors: { general: GENERIC_PLAYLIST_UPDATE_ERROR } }; }
		if (!previous) return { success: false, status: 404, values: validation.values, errors: {} };
	}
	let stored: Awaited<ReturnType<typeof savePlaylistImageFile>> | null = null;
	try {
		if (validation.imageOperation.kind === 'replace') {
			stored = await dependencies.saveImage(validation.imageOperation.image.file, validation.imageOperation.image.extension, maxImageSizeBytes);
		}
		const updated = await dependencies.update(ownerId, publicId, {
			...validation.input,
			...(validation.imageOperation.kind === 'retain' ? {} : {
				image: stored ? { storageKey: stored.storedFilename, mimeType: stored.mimeType, byteSize: stored.fileSizeBytes } : null
			})
		});
		if (!updated) {
			if (stored) await removeNewImage(stored.storedFilename, dependencies);
			return { success: false, status: 404, values: validation.values, errors: {} };
		}
	} catch (error) {
		if (stored) await removeNewImage(stored.storedFilename, dependencies);
		log('playlist_update_failed', error);
		return { success: false, status: 500, values: validation.values, errors: { general: GENERIC_PLAYLIST_UPDATE_ERROR } };
	}
	if (previous?.image && previous.image.storageKey !== stored?.storedFilename) {
		await cleanPreviousImage(previous.image.storageKey, dependencies);
	}
	return { success: true };
}

async function restore(quarantine: QuarantineStoredPlaylistImageResult, dependencies: PlaylistManagementDependencies): Promise<void> {
	if (quarantine.success && quarantine.state === 'quarantined') {
		try { await dependencies.restoreImage(quarantine.file); } catch (error) { log('playlist_delete_restore_failed', error); }
	}
}

export async function deletePlaylist(
	ownerId: string,
	publicId: string,
	dependencies: PlaylistManagementDependencies = defaultDependencies
): Promise<PlaylistDeletionResult> {
	let storage: OwnerPlaylistImageStorage | null;
	try { storage = await dependencies.findStorage(ownerId, publicId); }
	catch (error) { log('playlist_delete_lookup_failed', error); return { success: false, status: 500, message: GENERIC_PLAYLIST_DELETE_ERROR }; }
	if (!storage) return { success: false, status: 404, message: 'Playlist not found.' };
	let quarantine: QuarantineStoredPlaylistImageResult = { success: true, state: 'missing' };
	if (storage.image) {
		try { quarantine = await dependencies.quarantineImage(storage.image.storageKey); }
		catch (error) { log('playlist_delete_quarantine_failed', error); return { success: false, status: 500, message: GENERIC_PLAYLIST_DELETE_ERROR }; }
		if (!quarantine.success) return { success: false, status: 500, message: GENERIC_PLAYLIST_DELETE_ERROR };
	}
	let deleted: boolean;
	try { deleted = await dependencies.remove(ownerId, publicId); }
	catch (error) { await restore(quarantine, dependencies); log('playlist_delete_failed', error); return { success: false, status: 500, message: GENERIC_PLAYLIST_DELETE_ERROR }; }
	if (!deleted) { await restore(quarantine, dependencies); return { success: false, status: 404, message: 'Playlist not found.' }; }
	if (quarantine.success && quarantine.state === 'quarantined') {
		try { await dependencies.deleteQuarantinedImage(quarantine.file); }
		catch (error) { await restore(quarantine, dependencies); log('playlist_delete_finalize_failed', error); return { success: false, status: 500, message: GENERIC_PLAYLIST_DELETE_ERROR }; }
	}
	return { success: true };
}

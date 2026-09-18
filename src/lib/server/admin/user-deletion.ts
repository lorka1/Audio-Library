import { UserDeletionChangedError, type AdminUserDeletionSnapshot } from './contract.ts';
import type { prepareTrackDeletionMedia, PreparedTrackDeletionMedia } from '../tracks/deletion-media';
import type {
	deleteQuarantinedPlaylistImageFile,
	quarantineStoredPlaylistImageFile,
	restoreQuarantinedPlaylistImageFile,
	QuarantinedPlaylistImageFile
} from '../playlists/image-files';
import { safeErrorFields, writeSafeLog } from '../operational/logging.ts';

export const GENERIC_USER_DELETE_ERROR = 'The user could not be deleted right now.';

export interface UserDeletionDependencies {
	findSnapshot(userId: string): Promise<AdminUserDeletionSnapshot | null>;
	deleteDatabase(snapshot: AdminUserDeletionSnapshot): Promise<boolean>;
	prepareTrackMedia: typeof prepareTrackDeletionMedia;
	quarantinePlaylistImage: typeof quarantineStoredPlaylistImageFile;
	restorePlaylistImage: typeof restoreQuarantinedPlaylistImageFile;
	deleteQuarantinedPlaylistImage: typeof deleteQuarantinedPlaylistImageFile;
}

export type UserDeletionResult =
	| { success: true; deletedTrackIds: number[]; cleanupPending: boolean }
	| { success: false; status: 403 | 404 | 409 | 500; message: string };

function log(code: string, error: unknown, category: 'filesystem' | 'mongodb'): void {
	writeSafeLog({ severity: 'error', category, ...safeErrorFields(error), code });
}

async function restorePreparedMedia(
	tracks: PreparedTrackDeletionMedia[],
	playlistImages: QuarantinedPlaylistImageFile[],
	dependencies: UserDeletionDependencies
): Promise<void> {
	for (const image of playlistImages.reverse()) {
		try {
			await dependencies.restorePlaylistImage(image);
		} catch (error) {
			log('user_delete_playlist_image_restore_failed', error, 'filesystem');
		}
	}
	for (const track of tracks.reverse()) await track.restore();
}

async function finalizePreparedMedia(
	tracks: PreparedTrackDeletionMedia[],
	playlistImages: QuarantinedPlaylistImageFile[],
	dependencies: UserDeletionDependencies
): Promise<boolean> {
	let cleanupPending = false;
	for (const track of tracks) {
		if (!(await track.finalize())) cleanupPending = true;
	}
	for (const image of playlistImages) {
		try {
			await dependencies.deleteQuarantinedPlaylistImage(image);
		} catch (error) {
			cleanupPending = true;
			log('user_delete_playlist_image_finalize_failed', error, 'filesystem');
		}
	}
	return cleanupPending;
}

export async function deleteAdminUser(
	userId: string,
	adminId: string,
	dependencies: UserDeletionDependencies
): Promise<UserDeletionResult> {
	if (userId === adminId) {
		return { success: false, status: 403, message: 'You cannot delete your own account.' };
	}

	let snapshot: AdminUserDeletionSnapshot | null;
	try {
		snapshot = await dependencies.findSnapshot(userId);
	} catch (error) {
		log('user_delete_lookup_failed', error, 'mongodb');
		return { success: false, status: 500, message: GENERIC_USER_DELETE_ERROR };
	}
	if (!snapshot) return { success: false, status: 404, message: 'User not found.' };

	const trackMedia: PreparedTrackDeletionMedia[] = [];
	const playlistImages: QuarantinedPlaylistImageFile[] = [];
	for (const track of snapshot.tracks) {
		let prepared: PreparedTrackDeletionMedia | null;
		try {
			prepared = await dependencies.prepareTrackMedia(track);
		} catch (error) {
			log('user_delete_track_media_quarantine_failed', error, 'filesystem');
			prepared = null;
		}
		if (!prepared) {
			await restorePreparedMedia(trackMedia, playlistImages, dependencies);
			return { success: false, status: 500, message: GENERIC_USER_DELETE_ERROR };
		}
		trackMedia.push(prepared);
	}
	for (const playlist of snapshot.playlists) {
		if (!playlist.imageStorageKey) continue;
		try {
			const result = await dependencies.quarantinePlaylistImage(playlist.imageStorageKey);
			if (!result.success) {
				await restorePreparedMedia(trackMedia, playlistImages, dependencies);
				return { success: false, status: 500, message: GENERIC_USER_DELETE_ERROR };
			}
			if (result.state === 'quarantined') playlistImages.push(result.file);
		} catch (error) {
			log('user_delete_playlist_image_quarantine_failed', error, 'filesystem');
			await restorePreparedMedia(trackMedia, playlistImages, dependencies);
			return { success: false, status: 500, message: GENERIC_USER_DELETE_ERROR };
		}
	}

	let deleted: boolean;
	try {
		deleted = await dependencies.deleteDatabase(snapshot);
	} catch (error) {
		try {
			if (!(await dependencies.findSnapshot(userId))) {
				const cleanupPending = await finalizePreparedMedia(trackMedia, playlistImages, dependencies);
				return { success: true, deletedTrackIds: snapshot.tracks.map(({ publicId }) => publicId), cleanupPending };
			}
		} catch (lookupError) {
			log('user_delete_post_failure_lookup_failed', lookupError, 'mongodb');
		}
		await restorePreparedMedia(trackMedia, playlistImages, dependencies);
		if (error instanceof UserDeletionChangedError) {
			return { success: false, status: 409, message: 'This account changed. Please try again.' };
		}
		log('user_delete_transaction_failed', error, 'mongodb');
		return { success: false, status: 500, message: GENERIC_USER_DELETE_ERROR };
	}
	if (!deleted) {
		const cleanupPending = await finalizePreparedMedia(trackMedia, playlistImages, dependencies);
		return { success: true, deletedTrackIds: snapshot.tracks.map(({ publicId }) => publicId), cleanupPending };
	}

	const cleanupPending = await finalizePreparedMedia(trackMedia, playlistImages, dependencies);
	return {
		success: true,
		deletedTrackIds: snapshot.tracks.map(({ publicId }) => publicId),
		cleanupPending
	};
}

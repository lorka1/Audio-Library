import type { OwnerTrackStorage } from './contract';
import {
	deleteQuarantinedAudioFile,
	quarantineStoredAudioFile,
	restoreQuarantinedAudioFile,
	type QuarantineStoredAudioFileResult
} from './files';
import {
	deleteQuarantinedCoverImageFile,
	quarantineStoredCoverImageFile,
	restoreQuarantinedCoverImageFile,
	type QuarantineStoredCoverImageResult
} from './cover-files';
import { logTrackStorageError } from './logging';

export interface TrackDeletionMediaDependencies {
	quarantineFile: typeof quarantineStoredAudioFile;
	quarantineCoverFile: typeof quarantineStoredCoverImageFile;
	deleteQuarantinedFile: typeof deleteQuarantinedAudioFile;
	deleteQuarantinedCoverFile: typeof deleteQuarantinedCoverImageFile;
	restoreQuarantinedFile: typeof restoreQuarantinedAudioFile;
	restoreQuarantinedCoverFile: typeof restoreQuarantinedCoverImageFile;
}

const defaultDependencies: TrackDeletionMediaDependencies = {
	quarantineFile: quarantineStoredAudioFile,
	quarantineCoverFile: quarantineStoredCoverImageFile,
	deleteQuarantinedFile: deleteQuarantinedAudioFile,
	deleteQuarantinedCoverFile: deleteQuarantinedCoverImageFile,
	restoreQuarantinedFile: restoreQuarantinedAudioFile,
	restoreQuarantinedCoverFile: restoreQuarantinedCoverImageFile
};

export interface PreparedTrackDeletionMedia {
	restore(): Promise<boolean>;
	finalize(): Promise<boolean>;
}

async function restoreFile<T>(
	file: T,
	restore: (file: T) => Promise<void>
): Promise<boolean> {
	try {
		await restore(file);
		return true;
	} catch (error) {
		logTrackStorageError('Unable to restore quarantined track media.', error);
		return false;
	}
}

export async function prepareTrackDeletionMedia(
	track: Pick<OwnerTrackStorage, 'storedFilename' | 'coverImage'>,
	dependencies: TrackDeletionMediaDependencies = defaultDependencies
): Promise<PreparedTrackDeletionMedia | null> {
	let audio: QuarantineStoredAudioFileResult;
	try {
		audio = await dependencies.quarantineFile(track.storedFilename);
	} catch (error) {
		logTrackStorageError('Unable to prepare stored audio for deletion.', error);
		return null;
	}
	if (!audio.success) return null;

	let cover: QuarantineStoredCoverImageResult | null = null;
	if (track.coverImage) {
		try {
			cover = await dependencies.quarantineCoverFile(track.coverImage.storageKey);
		} catch (error) {
			logTrackStorageError('Unable to prepare stored cover image for deletion.', error);
		}
		if (!cover?.success) {
			if (audio.state === 'quarantined') {
				await restoreFile(audio.file, dependencies.restoreQuarantinedFile);
			}
			return null;
		}
	}

	return {
		async restore() {
			let restored = true;
			if (cover?.success && cover.state === 'quarantined') {
				restored = (await restoreFile(cover.file, dependencies.restoreQuarantinedCoverFile)) && restored;
			}
			if (audio.state === 'quarantined') {
				restored = (await restoreFile(audio.file, dependencies.restoreQuarantinedFile)) && restored;
			}
			return restored;
		},
		async finalize() {
			let finalized = true;
			if (audio.state === 'quarantined') {
				try {
					await dependencies.deleteQuarantinedFile(audio.file);
				} catch (error) {
					finalized = false;
					logTrackStorageError('Unable to remove quarantined audio after deletion.', error);
				}
			}
			if (cover?.success && cover.state === 'quarantined') {
				try {
					await dependencies.deleteQuarantinedCoverFile(cover.file);
				} catch (error) {
					finalized = false;
					logTrackStorageError('Unable to remove quarantined cover after deletion.', error);
				}
			}
			return finalized;
		}
	};
}

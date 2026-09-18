import { getApplicationAdminRepository } from './persistence';
import { deleteAdminUser, type UserDeletionDependencies } from './user-deletion';
import { prepareTrackDeletionMedia } from '../tracks/deletion-media';
import {
	deleteQuarantinedPlaylistImageFile,
	quarantineStoredPlaylistImageFile,
	restoreQuarantinedPlaylistImageFile
} from '../playlists/image-files';

const dependencies: UserDeletionDependencies = {
	findSnapshot: async (userId) => (await getApplicationAdminRepository()).findUserDeletionSnapshot(userId),
	deleteDatabase: async (snapshot) => (await getApplicationAdminRepository()).deleteUserCascade(snapshot),
	prepareTrackMedia: prepareTrackDeletionMedia,
	quarantinePlaylistImage: quarantineStoredPlaylistImageFile,
	restorePlaylistImage: restoreQuarantinedPlaylistImageFile,
	deleteQuarantinedPlaylistImage: deleteQuarantinedPlaylistImageFile
};

export function deleteAdminUserWithDefaults(userId: string, adminId: string) {
	return deleteAdminUser(userId, adminId, dependencies);
}

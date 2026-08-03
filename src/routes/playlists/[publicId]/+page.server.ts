import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireUser } from '$lib/server/auth/guards';
import { removeTrackFromPlaylistAction, playlistStatusMessage } from '$lib/server/playlists/actions';
import { getApplicationPlaylistRepository } from '$lib/server/playlists/persistence';
import { isValidPlaylistPublicId } from '$lib/server/playlists/validation';
import { safeErrorFields, writeSafeLog } from '$lib/server/operational/logging';
import { getServerConfig } from '$lib/server/config';
import { deletePlaylist, updatePlaylist } from '$lib/server/playlists/management';

function validPublicId(value: string): string {
	if (!isValidPlaylistPublicId(value)) error(404, 'Playlist not found.');
	return value;
}

function logFailure(event: Parameters<Actions[string]>[0], failure: unknown): void {
	writeSafeLog({
		severity: 'error',
		category: 'request',
		...safeErrorFields(failure),
		requestId: event.locals.requestId,
		method: event.request.method,
		route: 'playlist-detail'
	});
}

export const load = (async (event) => {
	const user = requireUser(event);
	const publicId = validPublicId(event.params.publicId);
	try {
		const playlist = await (
			await getApplicationPlaylistRepository()
		).findPlaylistForOwner(user.id, publicId);
		if (!playlist) error(404, 'Playlist not found.');
		return {
			playlist,
			maxPlaylistImageSizeMb: getServerConfig().playlistImageMaxSizeMb,
			updated: event.url.searchParams.get('updated') === '1',
			playlistNotice: playlistStatusMessage(event.url.searchParams.get('playlistStatus'))
		};
	} catch (loadError) {
		if (typeof loadError === 'object' && loadError && 'status' in loadError && loadError.status === 404) throw loadError;
		logFailure(event, loadError);
		error(500, 'This playlist is temporarily unavailable.');
	}
}) satisfies PageServerLoad;

export const actions = {
	update: async (event) => {
		const user = requireUser(event);
		const publicId = validPublicId(event.params.publicId);
		const result = await updatePlaylist(user.id, publicId, await event.request.formData(), getServerConfig().playlistImageMaxSizeBytes);
		if (!result.success) {
			if (result.status === 404) error(404, 'Playlist not found.');
			return fail(result.status, { action: 'update' as const, values: result.values, errors: result.errors });
		}
		redirect(303, `/playlists/${publicId}?updated=1`);
	},
	delete: async (event) => {
		const user = requireUser(event);
		const publicId = validPublicId(event.params.publicId);
		const formData = await event.request.formData();
		if (formData.get('confirmDelete') !== 'delete') {
			return fail(400, { action: 'delete' as const, deleteError: 'Confirm that you want to delete this playlist.' });
		}
		const result = await deletePlaylist(user.id, publicId);
		if (!result.success) {
			if (result.status === 404) error(404, 'Playlist not found.');
			return fail(500, { action: 'delete' as const, deleteError: result.message });
		}
		redirect(303, '/playlists?deleted=1');
	},
	removeFromPlaylist: removeTrackFromPlaylistAction
} satisfies Actions;

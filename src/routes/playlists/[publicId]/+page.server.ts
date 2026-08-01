import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireUser } from '$lib/server/auth/guards';
import { removeTrackFromPlaylistAction, playlistStatusMessage } from '$lib/server/playlists/actions';
import { getApplicationPlaylistRepository } from '$lib/server/playlists/persistence';
import { isValidPlaylistPublicId, validatePlaylistFormData } from '$lib/server/playlists/validation';
import { safeErrorFields, writeSafeLog } from '$lib/server/operational/logging';

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
		const validation = validatePlaylistFormData(await event.request.formData());
		if (!validation.success) return fail(400, { action: 'update' as const, values: validation.values, errors: validation.errors });
		try {
			const updated = await (
				await getApplicationPlaylistRepository()
			).updatePlaylistForOwner(user.id, publicId, validation.input);
			if (!updated) error(404, 'Playlist not found.');
		} catch (updateError) {
			if (typeof updateError === 'object' && updateError && 'status' in updateError && updateError.status === 404) throw updateError;
			logFailure(event, updateError);
			return fail(500, {
				action: 'update' as const,
				values: validation.values,
				errors: { general: 'Unable to update the playlist. Please try again.' }
			});
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
		try {
			const deleted = await (
				await getApplicationPlaylistRepository()
			).deletePlaylistForOwner(user.id, publicId);
			if (!deleted) error(404, 'Playlist not found.');
		} catch (deleteError) {
			if (typeof deleteError === 'object' && deleteError && 'status' in deleteError && deleteError.status === 404) throw deleteError;
			logFailure(event, deleteError);
			return fail(500, { action: 'delete' as const, deleteError: 'Unable to delete the playlist. Please try again.' });
		}
		redirect(303, '/playlists?deleted=1');
	},
	removeFromPlaylist: removeTrackFromPlaylistAction
} satisfies Actions;

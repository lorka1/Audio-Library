import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireUser } from '$lib/server/auth/guards';
import { safeErrorFields, writeSafeLog } from '$lib/server/operational/logging';
import { getApplicationPlaylistRepository } from '$lib/server/playlists/persistence';
import { getServerConfig } from '$lib/server/config';
import { createPlaylist } from '$lib/server/playlists/management';

export const load = (async (event) => {
	const user = requireUser(event);
	try {
		return {
			playlists: await (
				await getApplicationPlaylistRepository()
			).listPlaylistsForOwner(user.id),
			created: event.url.searchParams.get('created') === '1',
			deleted: event.url.searchParams.get('deleted') === '1',
			maxPlaylistImageSizeMb: getServerConfig().playlistImageMaxSizeMb
		};
	} catch (loadError) {
		writeSafeLog({
			severity: 'error',
			category: 'request',
			...safeErrorFields(loadError),
			requestId: event.locals.requestId,
			method: event.request.method,
			route: 'playlists'
		});
		error(500, 'Your playlists are temporarily unavailable.');
	}
}) satisfies PageServerLoad;

export const actions = {
	create: async (event) => {
		const user = requireUser(event);
		const config = getServerConfig();
		const result = await createPlaylist(user.id, await event.request.formData(), config.playlistImageMaxSizeBytes);
		if (!result.success) {
			return fail(result.status, {
				action: 'create' as const,
				values: result.values,
				errors: result.errors
			});
		}
		redirect(303, '/playlists?created=1');
	}
} satisfies Actions;

import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireUser } from '$lib/server/auth/guards';
import { safeErrorFields, writeSafeLog } from '$lib/server/operational/logging';
import { getApplicationPlaylistRepository } from '$lib/server/playlists/persistence';
import { validatePlaylistFormData } from '$lib/server/playlists/validation';

export const load = (async (event) => {
	const user = requireUser(event);
	try {
		return {
			playlists: await (
				await getApplicationPlaylistRepository()
			).listPlaylistsForOwner(user.id),
			created: event.url.searchParams.get('created') === '1',
			deleted: event.url.searchParams.get('deleted') === '1'
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
		const validation = validatePlaylistFormData(await event.request.formData());
		if (!validation.success) {
			return fail(400, {
				action: 'create' as const,
				values: validation.values,
				errors: validation.errors
			});
		}
		try {
			await (
				await getApplicationPlaylistRepository()
			).createPlaylist(user.id, validation.input);
		} catch (createError) {
			writeSafeLog({
				severity: 'error',
				category: 'request',
				...safeErrorFields(createError),
				requestId: event.locals.requestId,
				method: event.request.method,
				route: 'playlists'
			});
			return fail(500, {
				action: 'create' as const,
				values: validation.values,
				errors: { general: 'Unable to create the playlist. Please try again.' }
			});
		}
		redirect(303, '/playlists?created=1');
	}
} satisfies Actions;

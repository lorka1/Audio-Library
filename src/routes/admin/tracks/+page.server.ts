import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/auth/guards';
import { getApplicationAdminRepository } from '$lib/server/admin/persistence';
import { safeErrorFields, writeSafeLog } from '$lib/server/operational/logging';
import { parseTrackId } from '$lib/server/tracks/id';
import { deleteTrack } from '$lib/server/tracks/management';

export const load = (async (event) => {
	requireAdmin(event);

	try {
		return {
			tracks: await (await getApplicationAdminRepository()).listTracks()
		};
	} catch (loadError) {
		writeSafeLog({
			severity: 'error',
			category: 'mongodb',
			...safeErrorFields(loadError),
			requestId: event.locals.requestId,
			route: 'admin_tracks'
		});
		error(500, 'The track list is temporarily unavailable.');
	}
}) satisfies PageServerLoad;

export const actions = {
	delete: async (event) => {
		requireAdmin(event);

		const formData = await event.request.formData();
		const submittedTrackId = formData.get('trackId');
		const publicId =
			typeof submittedTrackId === 'string'
				? parseTrackId(submittedTrackId)
				: null;

		if (publicId === null) {
			return fail(400, { success: false, message: 'A valid track is required.' });
		}

		let ownerId: string | null;
		try {
			ownerId = await (
				await getApplicationAdminRepository()
			).findTrackOwnerId(publicId);
		} catch (lookupError) {
			writeSafeLog({
				severity: 'error',
				category: 'mongodb',
				...safeErrorFields(lookupError),
				requestId: event.locals.requestId,
				route: 'admin_track_delete'
			});
			return fail(500, {
				success: false,
				message: 'The track could not be deleted right now.'
			});
		}

		if (!ownerId) {
			return fail(404, { success: false, message: 'Track not found.' });
		}

		const result = await deleteTrack({ publicId, ownerId });
		if (!result.success) {
			return fail(result.status, { success: false, message: result.message });
		}

		return { success: true, message: 'Track deleted successfully.' };
	}
} satisfies Actions;

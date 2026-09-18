import { error } from '@sveltejs/kit';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/auth/guards';
import { getApplicationAdminRepository } from '$lib/server/admin/persistence';
import { deleteAdminUserWithDefaults } from '$lib/server/admin/user-deletion-runtime';
import { safeErrorFields, writeSafeLog } from '$lib/server/operational/logging';

export const load = (async (event) => {
	const admin = requireAdmin(event);

	try {
		return {
			currentAdminId: admin.id,
			users: await (await getApplicationAdminRepository()).listUsers()
		};
	} catch (loadError) {
		writeSafeLog({
			severity: 'error',
			category: 'mongodb',
			...safeErrorFields(loadError),
			requestId: event.locals.requestId,
			route: 'admin_users'
		});
		error(500, 'The user list is temporarily unavailable.');
	}
}) satisfies PageServerLoad;

export const actions = {
	delete: async (event) => {
		const admin = requireAdmin(event);
		const formData = await event.request.formData();
		const submittedUserId = formData.get('userId');
		if (
			typeof submittedUserId !== 'string' ||
			!/^[a-zA-Z0-9_-]{1,128}$/.test(submittedUserId)
		) {
			return fail(400, { success: false, message: 'A valid user is required.' });
		}

		const result = await deleteAdminUserWithDefaults(submittedUserId, admin.id);
		if (!result.success) {
			return fail(result.status, { success: false, message: result.message });
		}
		return {
			success: true,
			message: result.cleanupPending
				? 'User deleted. Media cleanup needs administrator attention.'
				: 'User and their data deleted successfully.',
			deletedTrackIds: result.deletedTrackIds
		};
	}
} satisfies Actions;

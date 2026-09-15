import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/auth/guards';
import { getApplicationAdminRepository } from '$lib/server/admin/persistence';
import { safeErrorFields, writeSafeLog } from '$lib/server/operational/logging';

export const load = (async (event) => {
	requireAdmin(event);

	try {
		return {
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

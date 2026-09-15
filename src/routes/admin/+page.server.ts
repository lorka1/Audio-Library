import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/auth/guards';
import { getApplicationAdminRepository } from '$lib/server/admin/persistence';
import { safeErrorFields, writeSafeLog } from '$lib/server/operational/logging';

export const load = (async (event) => {
	requireAdmin(event);

	try {
		return {
			stats: await (await getApplicationAdminRepository()).getDashboardStats()
		};
	} catch (loadError) {
		writeSafeLog({
			severity: 'error',
			category: 'mongodb',
			...safeErrorFields(loadError),
			requestId: event.locals.requestId,
			route: 'admin_dashboard'
		});
		error(500, 'Administrator statistics are temporarily unavailable.');
	}
}) satisfies PageServerLoad;

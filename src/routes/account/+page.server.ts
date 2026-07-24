import type { PageServerLoad } from './$types';
import { requireUser } from '$lib/server/auth/guards';

export const load = ((event) => {
	return {
		user: requireUser(event)
	};
}) satisfies PageServerLoad;

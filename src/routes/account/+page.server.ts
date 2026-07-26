import type { PageServerLoad } from './$types';
import { toAccountUser } from '$lib/account-user';
import { requireUser } from '$lib/server/auth/guards';

export const load = ((event) => {
	return {
		user: toAccountUser(requireUser(event))
	};
}) satisfies PageServerLoad;

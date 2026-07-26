import type { PageServerLoad } from './$types';
import { requireUser } from '$lib/server/auth/guards';
import { findAccountUserById } from '$lib/server/users/repository';

export const load = (async (event) => {
	const currentUser = requireUser(event);
	const user = await findAccountUserById(currentUser.id);

	if (!user) {
		throw new Error('The authenticated account record could not be found.');
	}

	return {
		user
	};
}) satisfies PageServerLoad;

import type { LayoutServerLoad } from './$types';
import { toNavigationUser } from '$lib/navigation-user';

export const load = (({ locals }) => {
	return {
		user: toNavigationUser(locals.user)
	};
}) satisfies LayoutServerLoad;

import type { LayoutServerLoad } from './$types';

export const load = (({ locals }) => {
	return {
		user: locals.user ? { username: locals.user.username } : null
	};
}) satisfies LayoutServerLoad;

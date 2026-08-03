import { redirect, type RequestHandler } from '@sveltejs/kit';
import { getServerConfig } from '$lib/server/config';
import { logAuthError } from '$lib/server/auth/logging';
import {
	deleteSessionCookie,
	invalidateSession
} from '$lib/server/auth/session';

export const POST: RequestHandler = async ({ cookies }) => {
	const token = cookies.get(getServerConfig().sessionCookieName);

	if (token) {
		try {
			await invalidateSession(token);
		} catch (error) {
			logAuthError('Logout session invalidation failed.', error);
			return new Response('Logout is temporarily unavailable. Please try again.', {
				status: 503,
				headers: {
					'cache-control': 'no-store'
				}
			});
		}
	}

	deleteSessionCookie(cookies);
	redirect(303, '/');
};

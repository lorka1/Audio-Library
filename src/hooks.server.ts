import type { Handle } from '@sveltejs/kit';
import { serverConfig } from '$lib/server/config';
import {
	deleteSessionCookie,
	validateSessionToken
} from '$lib/server/auth/session';
import { logAuthError } from '$lib/server/auth/logging';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	event.locals.session = null;

	const token = event.cookies.get(serverConfig.sessionCookieName);

	if (!token) {
		return resolve(event);
	}

	try {
		const authState = await validateSessionToken(token);

		if (!authState) {
			deleteSessionCookie(event.cookies);
		} else {
			event.locals.user = authState.user;
			event.locals.session = authState.session;
		}
	} catch (error) {
		logAuthError('Session validation failed.', error);
	}

	return resolve(event);
};

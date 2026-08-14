import type { Handle, HandleServerError } from '@sveltejs/kit';
import { getServerConfig } from '$lib/server/config';
import {
	deleteSessionCookie,
	validateSessionToken
} from '$lib/server/auth/session';
import { logAuthError } from '$lib/server/auth/logging';
import {
	createRequestId,
	routeCategory,
	safeErrorFields,
	writeSafeLog
} from '$lib/server/operational/logging';
import { initializeApplication } from '$lib/server/operational/startup';

export const handle: Handle = async ({ event, resolve }) => {
	const requestId = createRequestId();
	event.locals.requestId = requestId;
	event.locals.user = null;
	event.locals.session = null;

	if (event.url.pathname.startsWith('/api/health/')) {
		return resolve(event);
	}
	await initializeApplication();

	const token = event.cookies.get(getServerConfig().sessionCookieName);

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

export const handleError: HandleServerError = ({ error, event, status }) => {
	if (status >= 500) {
		writeSafeLog({
			severity: 'error',
			category: 'request',
			...safeErrorFields(error),
			requestId: event.locals.requestId,
			method: event.request.method,
			route: routeCategory(event.url.pathname),
			status
		});
	}
	return {
		message: 'The request could not be completed.',
		code: 'INTERNAL_ERROR'
	};
};

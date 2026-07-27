import type { Handle, HandleServerError } from '@sveltejs/kit';
import { serverConfig } from '$lib/server/config';
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
	const startedAt = performance.now();
	const requestId = createRequestId();
	const route = routeCategory(event.url.pathname);
	event.locals.requestId = requestId;
	event.locals.user = null;
	event.locals.session = null;

	if (event.url.pathname.startsWith('/api/health/')) {
		const response = await resolve(event);
		writeSafeLog({
			severity: 'info',
			category: 'request',
			code: 'request_complete',
			requestId,
			method: event.request.method,
			route,
			status: response.status,
			durationMs: Math.round(performance.now() - startedAt)
		});
		return response;
	}
	await initializeApplication();

	const token = event.cookies.get(serverConfig.sessionCookieName);

	if (!token) {
		const response = await resolve(event);
		writeSafeLog({
			severity: 'info',
			category: 'request',
			code: 'request_complete',
			requestId,
			method: event.request.method,
			route,
			status: response.status,
			durationMs: Math.round(performance.now() - startedAt)
		});
		return response;
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

	const response = await resolve(event);
	writeSafeLog({
		severity: 'info',
		category: 'request',
		code: 'request_complete',
		requestId,
		method: event.request.method,
		route,
		status: response.status,
		durationMs: Math.round(performance.now() - startedAt)
	});
	return response;
};

export const handleError: HandleServerError = ({ error, event, status }) => {
	writeSafeLog({
		severity: 'error',
		category: 'request',
		...safeErrorFields(error),
		requestId: event.locals.requestId,
		method: event.request.method,
		route: routeCategory(event.url.pathname),
		status
	});
	return {
		message: 'The request could not be completed.',
		code: 'INTERNAL_ERROR'
	};
};

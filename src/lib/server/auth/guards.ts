import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import type { CurrentUser, UserRole } from '$lib/types';

export function resolvePostLoginRedirect(
	role: UserRole,
	normalRedirectTo: string
): string {
	return role === 'admin' ? '/admin' : normalRedirectTo;
}

export function requireUser(event: RequestEvent): CurrentUser {
	if (!event.locals.user) {
		const returnPath = `${event.url.pathname}${event.url.search}`;
		redirect(303, `/login?redirectTo=${encodeURIComponent(returnPath)}`);
	}

	return event.locals.user;
}

export function requireGuest(event: RequestEvent): void {
	if (event.locals.user) {
		redirect(303, '/');
	}
}

export function requireAdmin(event: RequestEvent): CurrentUser {
	const user = requireUser(event);

	if (user.role !== 'admin') {
		error(403, 'Administrator access is required.');
	}

	return user;
}

import { redirect, type RequestEvent } from '@sveltejs/kit';
import type { CurrentUser } from '$lib/types';

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

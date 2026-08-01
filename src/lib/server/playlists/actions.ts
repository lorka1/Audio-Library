import { redirect, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '../auth/guards';
import { safeErrorFields, writeSafeLog } from '../operational/logging';
import { parseTrackId } from '../tracks/id';
import { getApplicationPlaylistRepository } from './persistence';
import { isValidPlaylistPublicId } from './validation';

export type PlaylistActionStatus =
	| 'added'
	| 'already-added'
	| 'removed'
	| 'not-present'
	| 'error';

function redirectWithStatus(event: RequestEvent, status: PlaylistActionStatus): never {
	const url = new URL(event.url);
	for (const key of [...url.searchParams.keys()]) {
		if (key.startsWith('/')) url.searchParams.delete(key);
	}
	url.searchParams.set('playlistStatus', status);
	redirect(303, `${url.pathname}${url.search}`);
}

function mutationInput(formData: FormData): {
	playlistPublicId: string;
	trackPublicId: number;
} | null {
	const rawPlaylistId = formData.get('playlistPublicId');
	const rawTrackId = formData.get('trackPublicId');
	if (
		typeof rawPlaylistId !== 'string' ||
		!isValidPlaylistPublicId(rawPlaylistId) ||
		typeof rawTrackId !== 'string'
	) return null;
	const trackPublicId = parseTrackId(rawTrackId);
	return trackPublicId === null
		? null
		: { playlistPublicId: rawPlaylistId, trackPublicId };
}

export async function addTrackToPlaylistAction(event: RequestEvent): Promise<never> {
	const user = requireUser(event);
	const input = mutationInput(await event.request.formData());
	if (!input) return redirectWithStatus(event, 'error');
	let result: Awaited<ReturnType<
		Awaited<ReturnType<typeof getApplicationPlaylistRepository>>['addTrackToPlaylist']
	>>;
	try {
		result = await (
			await getApplicationPlaylistRepository()
		).addTrackToPlaylist(user.id, input.playlistPublicId, input.trackPublicId);
	} catch (error) {
		writeSafeLog({
			severity: 'error',
			category: 'request',
			...safeErrorFields(error),
			requestId: event.locals.requestId,
			method: event.request.method,
			route: 'playlist-membership'
		});
		return redirectWithStatus(event, 'error');
	}
	if (result === 'added' || result === 'already-added') {
		return redirectWithStatus(event, result);
	}
	return redirectWithStatus(event, 'error');
}

export async function removeTrackFromPlaylistAction(event: RequestEvent): Promise<never> {
	const user = requireUser(event);
	const input = mutationInput(await event.request.formData());
	if (!input) return redirectWithStatus(event, 'error');
	let result: Awaited<ReturnType<
		Awaited<ReturnType<typeof getApplicationPlaylistRepository>>['removeTrackFromPlaylist']
	>>;
	try {
		result = await (
			await getApplicationPlaylistRepository()
		).removeTrackFromPlaylist(user.id, input.playlistPublicId, input.trackPublicId);
	} catch (error) {
		writeSafeLog({
			severity: 'error',
			category: 'request',
			...safeErrorFields(error),
			requestId: event.locals.requestId,
			method: event.request.method,
			route: 'playlist-membership'
		});
		return redirectWithStatus(event, 'error');
	}
	if (result === 'removed' || result === 'not-present') {
		return redirectWithStatus(event, result);
	}
	return redirectWithStatus(event, 'error');
}

export function playlistStatusMessage(value: string | null): {
	kind: 'success' | 'error';
	message: string;
} | null {
	switch (value) {
		case 'added':
			return { kind: 'success', message: 'Track added to the playlist.' };
		case 'already-added':
			return { kind: 'success', message: 'That track is already in the playlist.' };
		case 'removed':
			return { kind: 'success', message: 'Track removed from the playlist.' };
		case 'not-present':
			return { kind: 'success', message: 'That track is not in the playlist.' };
		case 'error':
			return { kind: 'error', message: 'Unable to update that playlist. Please try again.' };
		default:
			return null;
	}
}

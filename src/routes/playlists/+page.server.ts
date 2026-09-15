import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireUser } from '$lib/server/auth/guards';
import { safeErrorFields, writeSafeLog } from '$lib/server/operational/logging';
import { getApplicationPlaylistRepository } from '$lib/server/playlists/persistence';
import { getServerConfig } from '$lib/server/config';
import { createPlaylist } from '$lib/server/playlists/management';
import { playlistStatusMessage } from '$lib/server/playlists/actions';
import { parseTrackId } from '$lib/server/tracks/id';

type OptionalTrackContext =
	| { kind: 'none' }
	| { kind: 'valid'; publicId: number }
	| { kind: 'invalid' };

function optionalTrackContext(value: FormDataEntryValue | null): OptionalTrackContext {
	if (value === null) return { kind: 'none' };
	if (typeof value !== 'string') return { kind: 'invalid' };
	const publicId = parseTrackId(value);
	return publicId === null
		? { kind: 'invalid' }
		: { kind: 'valid', publicId };
}

function failedCreateValues(formData: FormData) {
	const name = formData.get('name');
	const description = formData.get('description');
	return {
		name: typeof name === 'string' ? name : '',
		description: typeof description === 'string' ? description : '',
		removeImage: false
	};
}

export const load = (async (event) => {
	const user = requireUser(event);
	const trackContext = optionalTrackContext(
		event.url.searchParams.get('trackPublicId')
	);
	try {
		return {
			playlists: await (
				await getApplicationPlaylistRepository()
			).listPlaylistsForOwner(user.id),
			created: event.url.searchParams.get('created') === '1',
			deleted: event.url.searchParams.get('deleted') === '1',
			addTrackPublicId:
				trackContext.kind === 'valid' ? trackContext.publicId : null,
			playlistNotice: playlistStatusMessage(
				event.url.searchParams.get('playlistStatus')
			),
			maxPlaylistImageSizeMb: getServerConfig().playlistImageMaxSizeMb
		};
	} catch (loadError) {
		writeSafeLog({
			severity: 'error',
			category: 'request',
			...safeErrorFields(loadError),
			requestId: event.locals.requestId,
			method: event.request.method,
			route: 'playlists'
		});
		error(500, 'Your playlists are temporarily unavailable.');
	}
}) satisfies PageServerLoad;

export const actions = {
	create: async (event) => {
		const user = requireUser(event);
		const config = getServerConfig();
		const formData = await event.request.formData();
		const trackContext = optionalTrackContext(formData.get('trackPublicId'));
		if (trackContext.kind === 'invalid') {
			return fail(400, {
				action: 'create' as const,
				values: failedCreateValues(formData),
				errors: {
					general:
						'The selected track is invalid. Reopen Add to playlist and try again.'
				}
			});
		}
		const result = await createPlaylist(
			user.id,
			formData,
			config.playlistImageMaxSizeBytes
		);
		if (!result.success) {
			return fail(result.status, {
				action: 'create' as const,
				values: result.values,
				errors: result.errors
			});
		}

		const redirectParameters = new URLSearchParams({ created: '1' });
		if (trackContext.kind === 'valid') {
			try {
				const membershipResult = await (
					await getApplicationPlaylistRepository()
				).addTrackToPlaylist(
					user.id,
					result.playlist.publicId,
					trackContext.publicId
				);
				redirectParameters.set(
					'playlistStatus',
					membershipResult === 'added' || membershipResult === 'already-added'
						? membershipResult
						: 'error'
				);
			} catch (membershipError) {
				writeSafeLog({
					severity: 'error',
					category: 'request',
					...safeErrorFields(membershipError),
					requestId: event.locals.requestId,
					method: event.request.method,
					route: 'playlist-create-membership'
				});
				redirectParameters.set('playlistStatus', 'error');
			}
		}

		redirect(303, `/playlists?${redirectParameters.toString()}`);
	}
} satisfies Actions;

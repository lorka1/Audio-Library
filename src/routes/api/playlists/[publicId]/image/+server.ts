import type { RequestHandler } from './$types';
import { getServerConfig } from '$lib/server/config';
import { readStoredPlaylistImageFile } from '$lib/server/playlists/image-files';
import { getApplicationPlaylistRepository } from '$lib/server/playlists/persistence';
import { isValidPlaylistPublicId } from '$lib/server/playlists/validation';
import { safeErrorFields, writeSafeLog } from '$lib/server/operational/logging';

const headers = {
	'cache-control': 'private, no-store',
	'content-security-policy': "default-src 'none'; sandbox",
	'x-content-type-options': 'nosniff'
};

function unavailable(status: 404 | 500): Response {
	return new Response(status === 404 ? 'Playlist image not found.' : 'Playlist image is temporarily unavailable.', { status, headers });
}

export const GET = (async ({ locals, params }) => {
	if (!locals.user || !isValidPlaylistPublicId(params.publicId)) return unavailable(404);
	let image;
	try {
		image = await (await getApplicationPlaylistRepository()).findPlaylistImageForOwner(locals.user.id, params.publicId);
	} catch (error) {
		writeSafeLog({ severity: 'error', category: 'filesystem', ...safeErrorFields(error), code: 'playlist_image_lookup_failed' });
		return unavailable(500);
	}
	if (!image) return unavailable(404);
	const config = getServerConfig();
	const stored = await readStoredPlaylistImageFile(image.storageKey, image.mimeType, image.byteSize, config.playlistImageMaxSizeBytes);
	if (!stored.success) return unavailable(stored.reason === 'unavailable' ? 500 : 404);
	return new Response(Uint8Array.from(stored.file.bytes).buffer, {
		status: 200,
		headers: {
			...headers,
			'content-length': String(stored.file.fileSizeBytes),
			'content-type': stored.file.mimeType
		}
	});
}) satisfies RequestHandler;

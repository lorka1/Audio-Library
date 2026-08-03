import type { RequestHandler } from './$types';
import { getServerConfig } from '$lib/server/config';
import { readStoredCoverImageFile } from '$lib/server/tracks/cover-files';
import { parseTrackId } from '$lib/server/tracks/id';
import { logTrackStorageError } from '$lib/server/tracks/logging';
import { getApplicationTrackRepository } from '$lib/server/tracks/persistence';

const CACHE_CONTROL = 'private, no-store';

function unavailableResponse(status: 404 | 500): Response {
	return new Response(
		status === 404 ? 'Cover image not found.' : 'Cover image is temporarily unavailable.',
		{
			status,
			headers: {
				'cache-control': CACHE_CONTROL,
				'content-security-policy': "default-src 'none'; sandbox",
				'x-content-type-options': 'nosniff'
			}
		}
	);
}

export const GET = (async ({ locals, params }) => {
	const id = parseTrackId(params.id);
	if (id === null) return unavailableResponse(404);

	let coverImage;
	try {
		coverImage = await (
			await getApplicationTrackRepository()
		).findTrackCoverForAccess(id, locals.user?.id);
	} catch (error) {
		logTrackStorageError('Track cover image lookup failed.', error);
		return unavailableResponse(500);
	}

	if (!coverImage) return unavailableResponse(404);
	const config = getServerConfig();

	const storedImage = await readStoredCoverImageFile(
		coverImage.storageKey,
		coverImage.mimeType,
		coverImage.byteSize,
		config.coverImageMaxSizeBytes
	);
	if (!storedImage.success) {
		return unavailableResponse(
			storedImage.reason === 'unavailable' ? 500 : 404
		);
	}

	const responseBody = Uint8Array.from(storedImage.file.bytes).buffer;
	return new Response(responseBody, {
		status: 200,
		headers: {
			'cache-control': CACHE_CONTROL,
			'content-length': String(storedImage.file.fileSizeBytes),
			'content-security-policy': "default-src 'none'; sandbox",
			'content-type': storedImage.file.mimeType,
			'x-content-type-options': 'nosniff'
		}
	});
}) satisfies RequestHandler;

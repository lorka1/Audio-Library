import type { RequestHandler } from './$types';
import { buildDownloadContentDisposition } from '$lib/server/tracks/download';
import {
	closeOpenedAudioFile,
	createAudioWebStream,
	getSafeAudioResponseMimeType,
	openStoredAudioFile
} from '$lib/server/tracks/files';
import { parseTrackId } from '$lib/server/tracks/id';
import { logTrackStorageError } from '$lib/server/tracks/logging';
import { getApplicationTrackRepository } from '$lib/server/tracks/persistence';

const CACHE_CONTROL = 'private, no-store';

function unavailableResponse(status: 404 | 500): Response {
	return new Response(status === 404 ? 'Track not found.' : 'Audio is temporarily unavailable.', {
		status,
		headers: {
			'cache-control': CACHE_CONTROL,
			'x-content-type-options': 'nosniff'
		}
	});
}

export const GET = (async ({ params }) => {
	const id = parseTrackId(params.id);

	if (id === null) {
		return unavailableResponse(404);
	}

	let trackFile;

	try {
		trackFile = await (
			await getApplicationTrackRepository()
		).findTrackForDownload(id);
	} catch (error) {
		logTrackStorageError('Public audio download lookup failed.', error);
		return unavailableResponse(500);
	}

	if (!trackFile) {
		return unavailableResponse(404);
	}

	const openedFile = await openStoredAudioFile(trackFile.storedFilename);

	if (!openedFile.success) {
		return unavailableResponse(openedFile.reason === 'unavailable' ? 500 : 404);
	}

	const headers = new Headers({
		'cache-control': CACHE_CONTROL,
		'content-disposition': buildDownloadContentDisposition(trackFile.originalFilename),
		'content-length': String(openedFile.file.fileSizeBytes),
		'content-type': getSafeAudioResponseMimeType(
			trackFile.storedFilename,
			trackFile.mimeType
		),
		'x-content-type-options': 'nosniff'
	});

	if (openedFile.file.fileSizeBytes === 0) {
		await closeOpenedAudioFile(openedFile.file);
		return new Response(null, { status: 200, headers });
	}

	try {
		return new Response(createAudioWebStream(openedFile.file), {
			status: 200,
			headers
		});
	} catch (error) {
		await closeOpenedAudioFile(openedFile.file);
		logTrackStorageError('Unable to create a public audio download.', error);
		return unavailableResponse(500);
	}
}) satisfies RequestHandler;

import type { RequestHandler } from './$types';
import {
	closeOpenedAudioFile,
	createAudioWebStream,
	getSafeAudioResponseMimeType,
	openStoredAudioFile
} from '$lib/server/tracks/files';
import { parseTrackId } from '$lib/server/tracks/id';
import { logTrackStorageError } from '$lib/server/tracks/logging';
import { parseByteRange } from '$lib/server/tracks/range';
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

export const GET = (async ({ params, request }) => {
	const id = parseTrackId(params.id);

	if (id === null) {
		return unavailableResponse(404);
	}

	let trackFile;

	try {
		trackFile = await (
			await getApplicationTrackRepository()
		).findTrackForStreaming(id);
	} catch (error) {
		logTrackStorageError('Public audio stream lookup failed.', error);
		return unavailableResponse(500);
	}

	if (!trackFile) {
		return unavailableResponse(404);
	}

	const openedFile = await openStoredAudioFile(trackFile.storedFilename);

	if (!openedFile.success) {
		return unavailableResponse(openedFile.reason === 'unavailable' ? 500 : 404);
	}

	const fileSize = openedFile.file.fileSizeBytes;
	const range = parseByteRange(request.headers.get('range'), fileSize);

	if (range.kind === 'unsatisfiable') {
		await closeOpenedAudioFile(openedFile.file);

		return new Response(null, {
			status: 416,
			headers: {
				'accept-ranges': 'bytes',
				'cache-control': CACHE_CONTROL,
				'content-length': '0',
				'content-range': `bytes */${fileSize}`,
				'x-content-type-options': 'nosniff'
			}
		});
	}

	const isPartial = range.kind === 'partial';
	const contentLength = isPartial ? range.length : fileSize;
	const headers = new Headers({
		'accept-ranges': 'bytes',
		'cache-control': CACHE_CONTROL,
		'content-length': String(contentLength),
		'content-type': getSafeAudioResponseMimeType(
			trackFile.storedFilename,
			trackFile.mimeType
		),
		'x-content-type-options': 'nosniff'
	});

	if (isPartial) {
		headers.set('content-range', `bytes ${range.start}-${range.end}/${fileSize}`);
	}

	if (contentLength === 0) {
		await closeOpenedAudioFile(openedFile.file);
		return new Response(null, { status: isPartial ? 206 : 200, headers });
	}

	try {
		const body = createAudioWebStream(
			openedFile.file,
			isPartial ? { start: range.start, end: range.end } : undefined
		);

		return new Response(body, {
			status: isPartial ? 206 : 200,
			headers
		});
	} catch (error) {
		await closeOpenedAudioFile(openedFile.file);
		logTrackStorageError('Unable to create a public audio stream.', error);
		return unavailableResponse(500);
	}
}) satisfies RequestHandler;

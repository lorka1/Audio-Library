import 'dotenv/config';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
	createExclusiveBackupDirectory,
	directoryAggregate,
	requireSafeDestinationRoot
} from './lib/backup-safety.mjs';

if (!process.env.AUDIO_STORAGE_PATH?.trim()) {
	throw new Error('Missing required environment variable AUDIO_STORAGE_PATH.');
}
if (!process.env.PLAYLIST_IMAGE_STORAGE_PATH?.trim()) {
	throw new Error('Missing required environment variable PLAYLIST_IMAGE_STORAGE_PATH.');
}
const source = resolve(process.env.AUDIO_STORAGE_PATH.trim());
const playlistImageSource = resolve(process.env.PLAYLIST_IMAGE_STORAGE_PATH.trim());
const root = requireSafeDestinationRoot(
	process.env.AUDIO_BACKUP_ROOT,
	'AUDIO_BACKUP_ROOT',
	{ forbidden: [source, playlistImageSource] }
);
const destination = await createExclusiveBackupDirectory(root, 'audio');
const incompleteMarker = resolve(destination, 'INCOMPLETE');
const copiedAudio = resolve(destination, 'audio');
const copiedPlaylistImages = resolve(destination, 'playlist-images');
await writeFile(incompleteMarker, 'Backup has not completed.\n', { flag: 'wx' });

try {
	const sourceAggregate = await directoryAggregate(source);
	const playlistImageAggregate = await directoryAggregate(playlistImageSource);
	await mkdir(copiedAudio, { recursive: false });
	await cp(source, copiedAudio, {
		recursive: true,
		errorOnExist: true,
		force: false,
		preserveTimestamps: true
	});
	await mkdir(copiedPlaylistImages, { recursive: false });
	await cp(playlistImageSource, copiedPlaylistImages, {
		recursive: true,
		errorOnExist: true,
		force: false,
		preserveTimestamps: true
	});
	const destinationAggregate = await directoryAggregate(copiedAudio);
	const destinationPlaylistImageAggregate = await directoryAggregate(copiedPlaylistImages);
	if (JSON.stringify(sourceAggregate) !== JSON.stringify(destinationAggregate)) {
		throw new Error('Audio backup aggregate mismatch.');
	}
	if (JSON.stringify(playlistImageAggregate) !== JSON.stringify(destinationPlaylistImageAggregate)) {
		throw new Error('Playlist image backup aggregate mismatch.');
	}
	await writeFile(
		resolve(destination, 'manifest.json'),
		`${JSON.stringify({
			timestamp: new Date().toISOString(),
			status: 'complete',
			format: 'private-filesystem-copy',
			aggregate: sourceAggregate,
			playlistImageAggregate
		}, null, 2)}\n`,
		{ flag: 'wx' }
	);
	await rm(incompleteMarker);
	console.log(JSON.stringify({
		status: 'complete',
		fileCount: sourceAggregate.fileCount + playlistImageAggregate.fileCount,
		byteSize: sourceAggregate.byteSize + playlistImageAggregate.byteSize,
		playlistImageFileCount: playlistImageAggregate.fileCount
	}));
} catch {
	console.error('Audio backup failed; the destination remains clearly marked incomplete.');
	process.exitCode = 1;
}

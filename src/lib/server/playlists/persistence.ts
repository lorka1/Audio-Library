import { connectMongoDevelopment } from '../mongodb/client';
import { getMongoCollections } from '../mongodb/collections';
import type { PlaylistRepository } from './contract';
import { createMongoPlaylistRepository } from './mongodb-repository';

let repositoryPromise: Promise<PlaylistRepository> | undefined;

export async function getFocusedMongoPlaylistRepository(): Promise<PlaylistRepository> {
	const { client, database } = await connectMongoDevelopment();
	const collections = getMongoCollections(database);
	return createMongoPlaylistRepository(
		client,
		collections.playlists,
		collections.playlistItems,
		collections.tracks
	);
}

export async function getApplicationPlaylistRepository(): Promise<PlaylistRepository> {
	if (!repositoryPromise) {
		const attempt = getFocusedMongoPlaylistRepository();
		let cached: Promise<PlaylistRepository>;
		cached = attempt.catch((error) => {
			if (repositoryPromise === cached) repositoryPromise = undefined;
			throw error;
		});
		repositoryPromise = cached;
	}
	return repositoryPromise;
}

import { connectMongoDevelopment } from '../mongodb/client';
import { getMongoCollections } from '../mongodb/collections';
import type { TrackRepository } from './contract';
import { createMongoTrackRepository } from './mongodb-repository';

let mongoTrackRepositoryPromise: Promise<TrackRepository> | undefined;

async function mongoTrackRepository(): Promise<TrackRepository> {
	if (!mongoTrackRepositoryPromise) {
		const attempt = getFocusedMongoTrackRepository();
		let cached: Promise<TrackRepository>;
		cached = attempt.catch((error) => {
			if (mongoTrackRepositoryPromise === cached) {
				mongoTrackRepositoryPromise = undefined;
			}
			throw error;
		});
		mongoTrackRepositoryPromise = cached;
	}
	return mongoTrackRepositoryPromise;
}

export async function getApplicationTrackRepository(): Promise<TrackRepository> {
	return mongoTrackRepository();
}

export async function getFocusedMongoTrackRepository(): Promise<TrackRepository> {
	const { client, database } = await connectMongoDevelopment();
	const collections = getMongoCollections(database);
	return createMongoTrackRepository(
		collections.tracks,
		collections.counters,
		collections.users,
		{
			client,
			playlistItems: collections.playlistItems
		}
	);
}

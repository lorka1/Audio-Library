import { connectMongoDevelopment } from '../mongodb/client';
import { getMongoCollections } from '../mongodb/collections';
import {
	readDatabaseBackend,
	type DatabaseBackendEnvironment
} from '../users/backend';
import type { TrackRepository } from './contract';
import { createMongoTrackRepository } from './mongodb-repository';
import { sqliteTrackRepository } from './sqlite-repository';

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

export async function getApplicationTrackRepository(
	environment: DatabaseBackendEnvironment = process.env
): Promise<TrackRepository> {
	return readDatabaseBackend(environment) === 'sqlite'
		? sqliteTrackRepository
		: mongoTrackRepository();
}

export async function getFocusedMongoTrackRepository(): Promise<TrackRepository> {
	const { database } = await connectMongoDevelopment();
	const collections = getMongoCollections(database);
	return createMongoTrackRepository(
		collections.tracks,
		collections.counters,
		collections.users
	);
}

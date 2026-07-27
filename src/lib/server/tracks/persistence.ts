import { connectMongoDevelopment } from '../mongodb/client';
import { getMongoCollections } from '../mongodb/collections';
import {
	readDatabaseBackend,
	type DatabaseBackendEnvironment
} from '../users/backend';
import type { TrackRepository } from './contract';
import { createMongoTrackRepository } from './mongodb-repository';
import { sqliteTrackRepository } from './sqlite-repository';

export const M4_MONGODB_TRACK_CUTOVER_GUARD_MESSAGE =
	'MongoDB application track routes remain guarded until M5 search, filter, and sort parity is complete.';

export function assertM4ApplicationPersistenceReady(
	environment: DatabaseBackendEnvironment = process.env
): void {
	if (readDatabaseBackend(environment) === 'mongodb') {
		throw new Error(M4_MONGODB_TRACK_CUTOVER_GUARD_MESSAGE);
	}
}

/**
 * Complete application routes use this selector. In M4 it intentionally
 * returns SQLite only; focused MongoDB repository verification uses the
 * factory below without enabling an incomplete application cutover.
 */
export function getApplicationTrackRepository(
	environment: DatabaseBackendEnvironment = process.env
): TrackRepository {
	assertM4ApplicationPersistenceReady(environment);
	return sqliteTrackRepository;
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

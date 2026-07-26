import type { Collection, Db } from 'mongodb';
import type {
	CounterDocument,
	SessionDocument,
	TrackDocument,
	UserDocument
} from './documents.ts';

export const MONGODB_COLLECTION_NAMES = {
	users: 'users',
	sessions: 'sessions',
	tracks: 'tracks',
	counters: 'counters'
} as const;

export interface MongoCollections {
	users: Collection<UserDocument>;
	sessions: Collection<SessionDocument>;
	tracks: Collection<TrackDocument>;
	counters: Collection<CounterDocument>;
}

export function getMongoCollections(database: Db): MongoCollections {
	return {
		users: database.collection<UserDocument>(
			MONGODB_COLLECTION_NAMES.users
		),
		sessions: database.collection<SessionDocument>(
			MONGODB_COLLECTION_NAMES.sessions
		),
		tracks: database.collection<TrackDocument>(
			MONGODB_COLLECTION_NAMES.tracks
		),
		counters: database.collection<CounterDocument>(
			MONGODB_COLLECTION_NAMES.counters
		)
	};
}

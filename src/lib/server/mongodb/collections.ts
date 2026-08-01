import type { Collection, Db } from 'mongodb';
import type {
	CounterDocument,
	HistoricalMigrationDocument,
	PlaylistDocument,
	PlaylistItemDocument,
	SessionDocument,
	TrackDocument,
	UserDocument
} from './documents.ts';

export const MONGODB_COLLECTION_NAMES = {
	users: 'users',
	sessions: 'sessions',
	tracks: 'tracks',
	playlists: 'playlists',
	playlistItems: 'playlistItems',
	counters: 'counters',
	migrations: 'migrations'
} as const;

export interface MongoCollections {
	users: Collection<UserDocument>;
	sessions: Collection<SessionDocument>;
	tracks: Collection<TrackDocument>;
	playlists: Collection<PlaylistDocument>;
	playlistItems: Collection<PlaylistItemDocument>;
	counters: Collection<CounterDocument>;
	migrations: Collection<HistoricalMigrationDocument>;
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
		playlists: database.collection<PlaylistDocument>(
			MONGODB_COLLECTION_NAMES.playlists
		),
		playlistItems: database.collection<PlaylistItemDocument>(
			MONGODB_COLLECTION_NAMES.playlistItems
		),
		counters: database.collection<CounterDocument>(
			MONGODB_COLLECTION_NAMES.counters
		),
		migrations: database.collection<HistoricalMigrationDocument>(
			MONGODB_COLLECTION_NAMES.migrations
		)
	};
}

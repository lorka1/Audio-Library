import type {
	CreateIndexesOptions,
	IndexDescription
} from 'mongodb';
import type { MongoCollections } from './collections.ts';

export type PlannedMongoIndex = IndexDescription & { name: string };

export const MONGODB_INDEX_DEFINITIONS = {
	users: [
		{
			name: 'users_username_unique',
			key: { username: 1 },
			unique: true
		},
		{
			name: 'users_email_unique',
			key: { email: 1 },
			unique: true
		}
	],
	sessions: [
		{
			name: 'sessions_token_hash_unique',
			key: { tokenHash: 1 },
			unique: true
		},
		{
			name: 'sessions_user_id_idx',
			key: { userId: 1 }
		},
		{
			name: 'sessions_expires_at_ttl',
			key: { expiresAt: 1 },
			expireAfterSeconds: 0
		}
	],
	tracks: [
		{
			name: 'tracks_public_id_unique',
			key: { publicId: 1 },
			unique: true
		},
		{
			name: 'tracks_storage_key_unique',
			key: { storageKey: 1 },
			unique: true
		},
		{
			name: 'tracks_owner_created_at_idx',
			key: { ownerId: 1, createdAt: -1, publicId: -1 }
		},
		{
			name: 'tracks_public_created_at_idx',
			key: { visibility: 1, createdAt: -1, publicId: -1 }
		},
		{
			name: 'tracks_public_bpm_idx',
			key: { visibility: 1, bpm: 1, createdAt: -1, publicId: -1 }
		},
		{
			name: 'tracks_public_musical_key_idx',
			key: {
				visibility: 1,
				musicalKey: 1,
				createdAt: -1,
				publicId: -1
			}
		},
		{
			name: 'tracks_public_genre_idx',
			key: { visibility: 1, genre: 1, createdAt: -1, publicId: -1 }
		}
	],
	playlists: [
		{
			name: 'playlists_public_id_unique',
			key: { publicId: 1 },
			unique: true
		},
		{
			name: 'playlists_owner_updated_at_idx',
			key: { ownerId: 1, updatedAt: -1, publicId: 1 }
		},
		{
			name: 'playlists_owner_public_id_idx',
			key: { ownerId: 1, publicId: 1 }
		}
	],
	playlistItems: [
		{
			name: 'playlist_items_playlist_track_unique',
			key: { playlistId: 1, trackId: 1 },
			unique: true
		},
		{
			name: 'playlist_items_playlist_added_at_idx',
			key: { playlistId: 1, addedAt: 1, _id: 1 }
		},
		{
			name: 'playlist_items_track_id_idx',
			key: { trackId: 1 }
		}
	]
} as const satisfies {
	users: readonly PlannedMongoIndex[];
	sessions: readonly PlannedMongoIndex[];
	tracks: readonly PlannedMongoIndex[];
	playlists: readonly PlannedMongoIndex[];
	playlistItems: readonly PlannedMongoIndex[];
};

export interface EnsureMongoIndexesOptions {
	maxTimeMS?: number;
}

export interface MongoIndexEnsureResult {
	users: string[];
	sessions: string[];
	tracks: string[];
	playlists: string[];
	playlistItems: string[];
	counters: [];
}

/** asynchronous MongoDB TTL cleanup means repositories must reject expired sessions */
export async function ensureMongoIndexes(
	collections: MongoCollections,
	options: EnsureMongoIndexesOptions = {}
): Promise<MongoIndexEnsureResult> {
	const createOptions: CreateIndexesOptions = {
		maxTimeMS: options.maxTimeMS
	};
	const [users, sessions, tracks, playlists, playlistItems] = await Promise.all([
		collections.users.createIndexes(
			[...MONGODB_INDEX_DEFINITIONS.users],
			createOptions
		),
		collections.sessions.createIndexes(
			[...MONGODB_INDEX_DEFINITIONS.sessions],
			createOptions
		),
		collections.tracks.createIndexes(
			[...MONGODB_INDEX_DEFINITIONS.tracks],
			createOptions
		),
		collections.playlists.createIndexes(
			[...MONGODB_INDEX_DEFINITIONS.playlists],
			createOptions
		),
		collections.playlistItems.createIndexes(
			[...MONGODB_INDEX_DEFINITIONS.playlistItems],
			createOptions
		)
	]);

	return {
		users,
		sessions,
		tracks,
		playlists,
		playlistItems,
		counters: []
	};
}

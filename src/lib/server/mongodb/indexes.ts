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
	]
} as const satisfies {
	users: readonly PlannedMongoIndex[];
	sessions: readonly PlannedMongoIndex[];
	tracks: readonly PlannedMongoIndex[];
};

export interface EnsureMongoIndexesOptions {
	maxTimeMS?: number;
}

export interface MongoIndexEnsureResult {
	users: string[];
	sessions: string[];
	tracks: string[];
	counters: [];
}

/**
 * MongoDB TTL cleanup is asynchronous. The future MongoDB session repository
 * must continue checking expiresAt and rejecting expired sessions before the
 * TTL monitor physically removes their documents.
 */
export async function ensureMongoIndexes(
	collections: MongoCollections,
	options: EnsureMongoIndexesOptions = {}
): Promise<MongoIndexEnsureResult> {
	const createOptions: CreateIndexesOptions = {
		maxTimeMS: options.maxTimeMS
	};
	const [users, sessions, tracks] = await Promise.all([
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
		)
	]);

	return {
		users,
		sessions,
		tracks,
		counters: []
	};
}

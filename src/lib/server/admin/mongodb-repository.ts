import type { MongoClient } from 'mongodb';
import type { MongoCollections } from '../mongodb/collections';
import { safeErrorFields, writeSafeLog } from '../operational/logging.ts';
import { normalizeUserRole } from '../../types/index.ts';
import {
	assertPositivePublicTrackId,
	UNKNOWN_TRACK_UPLOADER
} from '../tracks/contract.ts';
import type {
	AdminRepository,
	AdminTrackSummary,
	AdminUserSummary,
	AdminUserDeletionSnapshot
} from './contract.ts';
import { UserDeletionChangedError } from './contract.ts';

export const MONGODB_ADMIN_OPERATION_TIMEOUT_MS = 5_000;

interface AdminUserRecord {
	_id: string;
	username: string;
	email: string;
	role?: unknown;
	createdAt: Date;
	uploadedTrackCount: number;
}

interface AdminTrackRecord {
	publicId: number;
	title: string;
	artist: string;
	ownerUsername: string;
	createdAt: Date;
}

function toAdminUser(record: AdminUserRecord): AdminUserSummary {
	return {
		id: record._id,
		username: record.username,
		email: record.email,
		role: normalizeUserRole(record.role),
		createdAt: record.createdAt.toISOString(),
		uploadedTrackCount: record.uploadedTrackCount
	};
}

function toAdminTrack(record: AdminTrackRecord): AdminTrackSummary {
	return {
		publicId: record.publicId,
		title: record.title,
		artist: record.artist,
		ownerUsername: record.ownerUsername,
		createdAt: record.createdAt.toISOString()
	};
}

export function createMongoAdminRepository(
	collections: MongoCollections,
	options: { timeoutMS?: number; signal?: AbortSignal; client?: MongoClient } = {}
): AdminRepository {
	const operationOptions = {
		timeoutMS: options.timeoutMS ?? MONGODB_ADMIN_OPERATION_TIMEOUT_MS,
		signal: options.signal
	};

	return {
		async getDashboardStats() {
			const [totalUsers, totalTracks, totalPlaylists] =
				await Promise.all([
					collections.users.countDocuments({}, operationOptions),
					collections.tracks.countDocuments({}, operationOptions),
					collections.playlists.countDocuments({}, operationOptions)
				]);

			return {
				totalUsers,
				totalTracks,
				totalPlaylists
			};
		},

		async listUsers() {
			const records = await collections.users
				.aggregate<AdminUserRecord>(
					[
						{ $sort: { createdAt: -1, username: 1 } },
						{
							$lookup: {
								from: collections.tracks.collectionName,
								let: { userId: '$_id' },
								pipeline: [
									{ $match: { $expr: { $eq: ['$ownerId', '$$userId'] } } },
									{ $count: 'count' }
								],
								as: 'uploadedTracks'
							}
						},
						{
							$set: {
								uploadedTrackCount: {
									$ifNull: [{ $first: '$uploadedTracks.count' }, 0]
								}
							}
						},
						{
							$project: {
								_id: 1,
								username: 1,
								email: 1,
								role: 1,
								createdAt: 1,
								uploadedTrackCount: 1
							}
						}
					],
					operationOptions
				)
				.toArray();

			return records.map(toAdminUser);
		},

		async findUserDeletionSnapshot(userId) {
			const user = await collections.users.findOne(
				{ _id: userId },
				{ ...operationOptions, projection: { _id: 1, username: 1 } }
			);
			if (!user) return null;

			const [tracks, playlists] = await Promise.all([
				collections.tracks.find(
					{ ownerId: userId },
					{ ...operationOptions, projection: { _id: 1, publicId: 1, storageKey: 1, coverImage: 1 } }
				).toArray(),
				collections.playlists.find(
					{ ownerId: userId },
					{ ...operationOptions, projection: { _id: 1, image: 1 } }
				).toArray()
			]);

			return {
				userId,
				username: user.username,
				tracks: tracks.map((track) => ({
					id: track._id,
					publicId: track.publicId,
					storedFilename: track.storageKey,
					coverImage: track.coverImage?.storageKey ? track.coverImage : null
				})),
				playlists: playlists.map((playlist) => ({
					id: playlist._id,
					imageStorageKey: playlist.image?.storageKey ?? null
				}))
			} satisfies AdminUserDeletionSnapshot;
		},

		async deleteUserCascade(snapshot) {
			if (!options.client) throw new Error('MongoDB transactions are required for user deletion.');
			const session = options.client.startSession();
			let completed = false;
			let deleted = false;
			try {
				await session.withTransaction(async () => {
					const user = await collections.users.findOne(
						{ _id: snapshot.userId },
						{ ...operationOptions, session, projection: { _id: 1 } }
					);
					if (!user) {
						completed = true;
						deleted = false;
						return;
					}

					const currentTracks = await collections.tracks.find(
						{ ownerId: snapshot.userId },
						{ ...operationOptions, session, projection: { _id: 1, storageKey: 1, coverImage: 1 } }
					).toArray();
					const currentPlaylists = await collections.playlists.find(
						{ ownerId: snapshot.userId },
						{ ...operationOptions, session, projection: { _id: 1, image: 1 } }
					).toArray();
					const expectedTracks = new Map(snapshot.tracks.map((track) => [track.id, track]));
					const expectedPlaylists = new Map(snapshot.playlists.map((playlist) => [playlist.id, playlist]));
					const tracksMatch = currentTracks.length === expectedTracks.size && currentTracks.every((track) => {
						const expected = expectedTracks.get(track._id);
						return expected?.storedFilename === track.storageKey &&
							(expected.coverImage?.storageKey ?? null) === (track.coverImage?.storageKey ?? null);
					});
					const playlistsMatch = currentPlaylists.length === expectedPlaylists.size && currentPlaylists.every((playlist) =>
						expectedPlaylists.get(playlist._id)?.imageStorageKey === (playlist.image?.storageKey ?? null)
					);
					if (!tracksMatch || !playlistsMatch) {
						throw new UserDeletionChangedError();
					}

					const trackIds = snapshot.tracks.map(({ id }) => id);
					const playlistIds = snapshot.playlists.map(({ id }) => id);
					if (trackIds.length > 0) {
						const result = await collections.tracks.deleteMany(
							{ ownerId: snapshot.userId, _id: { $in: trackIds } },
							{ ...operationOptions, session }
						);
						if (result.deletedCount !== trackIds.length) throw new UserDeletionChangedError();
					}
					const references = [
						...(trackIds.length > 0 ? [{ trackId: { $in: trackIds } }] : []),
						...(playlistIds.length > 0 ? [{ playlistId: { $in: playlistIds } }] : [])
					];
					if (references.length > 0) {
						await collections.playlistItems.deleteMany({ $or: references }, { ...operationOptions, session });
					}
					if (playlistIds.length > 0) {
						const result = await collections.playlists.deleteMany(
							{ ownerId: snapshot.userId, _id: { $in: playlistIds } },
							{ ...operationOptions, session }
						);
						if (result.deletedCount !== playlistIds.length) throw new UserDeletionChangedError();
					}
					await collections.sessions.deleteMany({ userId: snapshot.userId }, { ...operationOptions, session });
					const result = await collections.users.deleteOne({ _id: snapshot.userId }, { ...operationOptions, session });
					if (result.deletedCount !== 1) throw new UserDeletionChangedError();
					completed = true;
					deleted = true;
				}, {
					maxCommitTimeMS: 5_000,
					readPreference: 'primary',
					readConcern: { level: 'snapshot' },
					writeConcern: { w: 'majority' }
				});
			} finally {
				try {
					await session.endSession();
				} catch (error) {
					writeSafeLog({ severity: 'error', category: 'shutdown', ...safeErrorFields(error) });
				}
			}
			if (!completed) throw new Error('MongoDB user deletion transaction did not commit.');
			return deleted;
		},

		async listTracks() {
			const records = await collections.tracks
				.aggregate<AdminTrackRecord>(
					[
						{ $sort: { createdAt: -1, publicId: -1 } },
						{
							$lookup: {
								from: collections.users.collectionName,
								localField: 'ownerId',
								foreignField: '_id',
								as: 'owner',
								pipeline: [{ $project: { _id: 0, username: 1 } }]
							}
						},
						{
							$set: {
								ownerUsername: {
									$ifNull: [{ $first: '$owner.username' }, UNKNOWN_TRACK_UPLOADER]
								}
							}
						},
						{
							$project: {
								_id: 0,
								publicId: 1,
								title: 1,
								artist: '$ownerUsername',
								ownerUsername: 1,
								createdAt: 1
							}
						}
					],
					operationOptions
				)
				.toArray();

			return records.map(toAdminTrack);
		},

		async findTrackOwnerId(publicId) {
			assertPositivePublicTrackId(publicId);
			const track = await collections.tracks.findOne(
				{ publicId },
				{ ...operationOptions, projection: { _id: 0, ownerId: 1 } }
			);
			return track?.ownerId ?? null;
		}
	};
}

import type { MongoCollections } from '../mongodb/collections';
import { normalizeUserRole } from '../../types/index.ts';
import {
	assertPositivePublicTrackId,
	UNKNOWN_TRACK_UPLOADER
} from '../tracks/contract.ts';
import type {
	AdminRepository,
	AdminTrackSummary,
	AdminUserSummary
} from './contract.ts';

export const MONGODB_ADMIN_OPERATION_TIMEOUT_MS = 5_000;

interface AdminUserRecord {
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
	options: { timeoutMS?: number; signal?: AbortSignal } = {}
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
								_id: 0,
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

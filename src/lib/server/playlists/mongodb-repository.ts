import { randomBytes, randomUUID } from 'node:crypto';
import {
	MongoServerError,
	type ClientSession,
	type Collection,
	type MongoClient
} from 'mongodb';
import type {
	PlaylistDocument,
	PlaylistItemDocument,
	TrackDocument,
	UserDocument
} from '../mongodb/documents.ts';
import type {
	OwnerPlaylist,
	PlaylistSummary,
	PlaylistTrack
} from '../../types/index.ts';
import { cleanupPreservingPrimaryFailure } from '../operational/cleanup.ts';
import { safeErrorFields, writeSafeLog } from '../operational/logging.ts';
import {
	assertPositivePublicTrackId,
	UNKNOWN_TRACK_UPLOADER
} from '../tracks/contract.ts';
import type {
	PlaylistInput,
	PlaylistRepository
} from './contract.ts';
import { requirePlaylistOwnerId } from './contract.ts';
import { isValidPlaylistPublicId } from './validation.ts';

export const MONGODB_PLAYLIST_OPERATION_TIMEOUT_MS = 5_000;
const TRANSACTION_TIMEOUT_MS = 8_000;

export interface MongoPlaylistRepositoryOptions {
	timeoutMS?: number;
	signal?: AbortSignal;
	now?: () => Date;
	createInternalId?: () => string;
	createPublicId?: () => string;
}

interface PlaylistSummaryRecord {
	publicId: string;
	name: string;
	description: string | null;
	trackCount: number;
	createdAt: Date;
	updatedAt: Date;
}

interface PlaylistItemTrackRecord {
	addedAt: Date;
	track?: Pick<
		TrackDocument,
		| 'publicId'
		| 'ownerId'
		| 'title'
		| 'coverImage'
		| 'bpm'
		| 'musicalKey'
		| 'genre'
		| 'description'
		| 'visibility'
	> & { artist: string };
}

function summary(record: PlaylistSummaryRecord): PlaylistSummary {
	return {
		publicId: record.publicId,
		name: record.name,
		description: record.description,
		trackCount: record.trackCount,
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString()
	};
}

function hasCover(track: NonNullable<PlaylistItemTrackRecord['track']>): boolean {
	return Boolean(
		track.coverImage &&
			typeof track.coverImage.storageKey === 'string' &&
			track.coverImage.storageKey.length > 0 &&
			typeof track.coverImage.mimeType === 'string' &&
			Number.isSafeInteger(track.coverImage.byteSize) &&
			track.coverImage.byteSize > 0
	);
}

function playlistTrack(record: PlaylistItemTrackRecord): PlaylistTrack | null {
	if (!record.track) return null;
	return {
		id: record.track.publicId,
		title: record.track.title,
		artist: record.track.artist,
		coverImageUrl: hasCover(record.track)
			? `/api/tracks/${record.track.publicId}/cover`
			: null,
		bpm: record.track.bpm,
		musicalKey: record.track.musicalKey,
		genre: record.track.genre,
		description: record.track.description,
		visibility: record.track.visibility,
		addedAt: record.addedAt.toISOString()
	};
}

function duplicateMembership(error: unknown): boolean {
	if (!(error instanceof MongoServerError) || error.code !== 11000) return false;
	const pattern = error.keyPattern as Record<string, unknown> | undefined;
	return Boolean(
		pattern && Object.hasOwn(pattern, 'playlistId') && Object.hasOwn(pattern, 'trackId')
	);
}

export function createMongoPlaylistRepository(
	client: MongoClient,
	playlists: Collection<PlaylistDocument>,
	playlistItems: Collection<PlaylistItemDocument>,
	tracks: Collection<TrackDocument>,
	users: Collection<UserDocument>,
	options: MongoPlaylistRepositoryOptions = {}
): PlaylistRepository {
	const timeoutMS = options.timeoutMS ?? MONGODB_PLAYLIST_OPERATION_TIMEOUT_MS;
	const operationOptions = { timeoutMS, signal: options.signal };
	const now = options.now ?? (() => new Date());
	const createInternalId = options.createInternalId ?? randomUUID;
	const createPublicId = options.createPublicId ?? (() => randomBytes(18).toString('base64url'));

	async function transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
		const session = client.startSession();
		let result: T | undefined;
		let completed = false;
		let primaryFailure: unknown;
		try {
			await session.withTransaction(async () => {
				result = await work(session);
				completed = true;
			}, {
				maxCommitTimeMS: TRANSACTION_TIMEOUT_MS,
				readPreference: 'primary',
				readConcern: { level: 'snapshot' },
				writeConcern: { w: 'majority' }
			});
		} catch (error) {
			primaryFailure = error;
			throw error;
		} finally {
			await cleanupPreservingPrimaryFailure(
				primaryFailure,
				() => session.endSession(),
				(error) => writeSafeLog({
					severity: 'error',
					category: 'shutdown',
					...safeErrorFields(error)
				})
			);
		}
		if (!completed) throw new Error('MongoDB playlist transaction did not commit.');
		return result as T;
	}

	function assertPublicId(publicId: string): void {
		if (!isValidPlaylistPublicId(publicId)) throw new Error('Invalid playlist public ID.');
	}

	async function summariesForOwner(ownerId: string): Promise<PlaylistSummaryRecord[]> {
		return playlists.aggregate<PlaylistSummaryRecord>([
			{ $match: { ownerId } },
			{ $sort: { updatedAt: -1, publicId: 1 } },
			{
				$lookup: {
					from: playlistItems.collectionName,
					localField: '_id',
					foreignField: 'playlistId',
					as: 'items',
					pipeline: [{ $project: { _id: 1 } }]
				}
			},
			{
				$project: {
					_id: 0,
					publicId: 1,
					name: 1,
					description: 1,
					trackCount: { $size: '$items' },
					createdAt: 1,
					updatedAt: 1
				}
			}
		], operationOptions).toArray();
	}

	async function membershipsForTracks(
		ownerId: string,
		trackPublicIds: number[]
	): Promise<Record<string, string[]>> {
		requirePlaylistOwnerId(ownerId);
		const ids = [...new Set(trackPublicIds)];
		for (const id of ids) assertPositivePublicTrackId(id);
		const output = Object.fromEntries(ids.map((id) => [String(id), [] as string[]]));
		if (ids.length === 0) return output;
		const [accessibleTracks, ownedPlaylists] = await Promise.all([
			tracks.find(
				{ publicId: { $in: ids }, $or: [{ visibility: 'public' }, { ownerId }] },
				{ ...operationOptions, projection: { _id: 1, publicId: 1 } }
			).toArray(),
			playlists.find(
				{ ownerId },
				{ ...operationOptions, projection: { _id: 1, publicId: 1 } }
			).toArray()
		]);
		if (accessibleTracks.length === 0 || ownedPlaylists.length === 0) return output;
		const trackByInternalId = new Map(accessibleTracks.map((track) => [track._id, track.publicId]));
		const playlistByInternalId = new Map(ownedPlaylists.map((playlist) => [playlist._id, playlist.publicId]));
		const items = await playlistItems.find(
			{ trackId: { $in: [...trackByInternalId.keys()] }, playlistId: { $in: [...playlistByInternalId.keys()] } },
			{ ...operationOptions, projection: { _id: 0, trackId: 1, playlistId: 1 } }
		).toArray();
		for (const item of items) {
			const trackPublicId = trackByInternalId.get(item.trackId);
			const playlistPublicId = playlistByInternalId.get(item.playlistId);
			if (trackPublicId !== undefined && playlistPublicId) {
				output[String(trackPublicId)].push(playlistPublicId);
			}
		}
		return output;
	}

	return {
		async createPlaylist(ownerId, input) {
			requirePlaylistOwnerId(ownerId);
			const timestamp = now();
			const document: PlaylistDocument = {
				_id: createInternalId(),
				publicId: createPublicId(),
				ownerId,
				name: input.name,
				description: input.description,
				createdAt: timestamp,
				updatedAt: timestamp
			};
			assertPublicId(document.publicId);
			await playlists.insertOne(document, operationOptions);
			return summary({ ...document, trackCount: 0 });
		},

		async listPlaylistsForOwner(ownerId) {
			requirePlaylistOwnerId(ownerId);
			return (await summariesForOwner(ownerId)).map(summary);
		},

		async findPlaylistForOwner(ownerId, publicId) {
			requirePlaylistOwnerId(ownerId);
			assertPublicId(publicId);
			const playlist = await playlists.findOne(
				{ ownerId, publicId },
				{ ...operationOptions, projection: { _id: 1, publicId: 1, name: 1, description: 1, createdAt: 1, updatedAt: 1 } }
			);
			if (!playlist) return null;

			const records = await playlistItems.aggregate<PlaylistItemTrackRecord>([
				{ $match: { playlistId: playlist._id } },
				{ $sort: { addedAt: 1, _id: 1 } },
				{
					$lookup: {
						from: tracks.collectionName,
						localField: 'trackId',
						foreignField: '_id',
						as: 'track',
						pipeline: [
							{
								$lookup: {
									from: users.collectionName,
									localField: 'ownerId',
									foreignField: '_id',
									as: 'uploader',
									pipeline: [{ $project: { _id: 0, username: 1 } }]
								}
							},
							{
								$set: {
									artist: {
										$ifNull: [{ $first: '$uploader.username' }, UNKNOWN_TRACK_UPLOADER]
									}
								}
							},
							{
								$project: {
									_id: 0,
									publicId: 1,
									ownerId: 1,
									title: 1,
									artist: 1,
									coverImage: 1,
									bpm: 1,
									musicalKey: 1,
									genre: 1,
									description: 1,
									visibility: 1
								}
							}
						]
					}
				},
				{ $set: { track: { $first: '$track' } } },
				{ $project: { _id: 0, addedAt: 1, track: 1 } }
			], operationOptions).toArray();
			const visibleTracks = records
				.filter(({ track }) => track && (track.visibility === 'public' || track.ownerId === ownerId))
				.map(playlistTrack)
				.filter((track): track is PlaylistTrack => track !== null);
			return {
				publicId: playlist.publicId,
				name: playlist.name,
				description: playlist.description,
				trackCount: visibleTracks.length,
				createdAt: playlist.createdAt.toISOString(),
				updatedAt: playlist.updatedAt.toISOString(),
				tracks: visibleTracks,
				unavailableTrackCount: records.length - visibleTracks.length
			} satisfies OwnerPlaylist;
		},

		async updatePlaylistForOwner(ownerId, publicId, input) {
			requirePlaylistOwnerId(ownerId);
			assertPublicId(publicId);
			const document = await playlists.findOneAndUpdate(
				{ ownerId, publicId },
				{ $set: { name: input.name, description: input.description, updatedAt: now() } },
				{ ...operationOptions, returnDocument: 'after', projection: { _id: 1, publicId: 1, name: 1, description: 1, createdAt: 1, updatedAt: 1 } }
			);
			if (!document) return null;
			const trackCount = await playlistItems.countDocuments(
				{ playlistId: document._id },
				operationOptions
			);
			return summary({ ...document, trackCount });
		},

		async deletePlaylistForOwner(ownerId, publicId) {
			requirePlaylistOwnerId(ownerId);
			assertPublicId(publicId);
			return transaction(async (session) => {
				const playlist = await playlists.findOne(
					{ ownerId, publicId },
					{ ...operationOptions, session, projection: { _id: 1 } }
				);
				if (!playlist) return false;
				await playlistItems.deleteMany({ playlistId: playlist._id }, { ...operationOptions, session });
				const deleted = await playlists.deleteOne({ _id: playlist._id, ownerId }, { ...operationOptions, session });
				return deleted.deletedCount === 1;
			});
		},

		async addTrackToPlaylist(ownerId, playlistPublicId, trackPublicId) {
			requirePlaylistOwnerId(ownerId);
			assertPublicId(playlistPublicId);
			assertPositivePublicTrackId(trackPublicId);
			try {
				return await transaction(async (session) => {
					const playlist = await playlists.findOne(
						{ ownerId, publicId: playlistPublicId },
						{ ...operationOptions, session, projection: { _id: 1 } }
					);
					if (!playlist) return 'not-found' as const;
					const track = await tracks.findOne(
						{ publicId: trackPublicId, $or: [{ visibility: 'public' }, { ownerId }] },
						{ ...operationOptions, session, projection: { _id: 1 } }
					);
					if (!track) return 'track-unavailable' as const;
					const existing = await playlistItems.findOne(
						{ playlistId: playlist._id, trackId: track._id },
						{ ...operationOptions, session, projection: { _id: 1 } }
					);
					if (existing) return 'already-added' as const;
					await playlistItems.insertOne({
						_id: createInternalId(),
						playlistId: playlist._id,
						trackId: track._id,
						addedAt: now()
					}, { ...operationOptions, session });
					await playlists.updateOne(
						{ _id: playlist._id, ownerId },
						{ $set: { updatedAt: now() } },
						{ ...operationOptions, session }
					);
					return 'added' as const;
				});
			} catch (error) {
				if (!duplicateMembership(error)) throw error;
				const [playlist, track] = await Promise.all([
					playlists.findOne(
						{ ownerId, publicId: playlistPublicId },
						{ ...operationOptions, projection: { _id: 1 } }
					),
					tracks.findOne(
						{ publicId: trackPublicId, $or: [{ visibility: 'public' }, { ownerId }] },
						{ ...operationOptions, projection: { _id: 1 } }
					)
				]);
				if (!playlist) return 'not-found';
				if (!track) return 'track-unavailable';
				const existing = await playlistItems.findOne(
					{ playlistId: playlist._id, trackId: track._id },
					{ ...operationOptions, projection: { _id: 1 } }
				);
				if (existing) return 'already-added';
				throw error;
			}
		},

		async removeTrackFromPlaylist(ownerId, playlistPublicId, trackPublicId) {
			requirePlaylistOwnerId(ownerId);
			assertPublicId(playlistPublicId);
			assertPositivePublicTrackId(trackPublicId);
			return transaction(async (session) => {
				const playlist = await playlists.findOne(
					{ ownerId, publicId: playlistPublicId },
					{ ...operationOptions, session, projection: { _id: 1 } }
				);
				if (!playlist) return 'not-found' as const;
				const track = await tracks.findOne(
					{ publicId: trackPublicId, $or: [{ visibility: 'public' }, { ownerId }] },
					{ ...operationOptions, session, projection: { _id: 1 } }
				);
				if (!track) return 'not-present' as const;
				const deleted = await playlistItems.deleteOne(
					{ playlistId: playlist._id, trackId: track._id },
					{ ...operationOptions, session }
				);
				if (deleted.deletedCount !== 1) return 'not-present' as const;
				await playlists.updateOne(
					{ _id: playlist._id, ownerId },
					{ $set: { updatedAt: now() } },
					{ ...operationOptions, session }
				);
				return 'removed' as const;
			});
		},

		async getTrackPlaylistMembership(ownerId, trackPublicId) {
			const memberships = await membershipsForTracks(ownerId, [trackPublicId]);
			return memberships[String(trackPublicId)] ?? [];
		},

		async getTrackPlaylistMemberships(ownerId, trackPublicIds) {
			return membershipsForTracks(ownerId, trackPublicIds);
		},

		async deleteItemsForTrack(trackId, session) {
			if (!trackId.trim()) throw new Error('An internal track ID is required.');
			const result = await playlistItems.deleteMany({ trackId }, { ...operationOptions, session });
			return result.deletedCount;
		}
	};
}

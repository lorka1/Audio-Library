import {
	MongoServerError,
	type Collection,
	type FindOptions,
	type MongoClient
} from 'mongodb';
import type {
	CounterDocument,
	PlaylistItemDocument,
	TrackDocument,
	UserDocument
} from '../mongodb/documents.ts';
import { TRACK_PUBLIC_ID_COUNTER } from '../mongodb/documents.ts';
import type {
	CreateTrackInput,
	DuplicateTrackField,
	OwnerTrackStorage,
	StoredCoverImage,
	TrackCoverForDelivery,
	TrackForDownload,
	TrackForStreaming,
	TrackRepository,
	UpdateOwnerTrackMetadataInput
} from './contract.ts';
import {
	escapeRegexSearchTerm,
	type TrackSearchFilters
} from '../../tracks-query.ts';
import {
	assertPositivePublicTrackId,
	DuplicateTrackError,
	requireTrackOwnerId,
	UNKNOWN_TRACK_UPLOADER
} from './contract.ts';
import { toOwnerTrack, type OwnerTrackRecord } from './owner-model.ts';
import { toPublicTrack, type PublicTrackRecord } from './public-model.ts';
import { cleanupPreservingPrimaryFailure } from '../operational/cleanup.ts';
import { safeErrorFields, writeSafeLog } from '../operational/logging.ts';

export const MONGODB_TRACK_OPERATION_TIMEOUT_MS = 5_000;
export const MONGODB_BASIC_PUBLIC_TRACK_LIMIT = 200;

export interface MongoTrackRepositoryOptions {
	timeoutMS?: number;
	signal?: AbortSignal;
	client?: MongoClient;
	playlistItems?: Collection<PlaylistItemDocument>;
}

const TRACK_DELETE_TRANSACTION_TIMEOUT_MS = 8_000;

interface PublicTrackAggregateRecord extends PublicTrackRecord {}

const ownerAggregateProjection = {
	_id: 0,
	publicId: 1,
	title: 1,
	artist: { $ifNull: ['$owner.username', UNKNOWN_TRACK_UPLOADER] },
	bpm: 1,
	musicalKey: 1,
	genre: 1,
	description: 1,
	visibility: 1,
	fileSizeBytes: 1,
	mimeType: 1,
	originalFilename: 1,
	coverImage: 1,
	createdAt: 1,
	updatedAt: 1
} as const;

const streamingProjection = {
	_id: 0,
	publicId: 1,
	storageKey: 1,
	mimeType: 1,
	fileSizeBytes: 1,
	visibility: 1
} as const;

const downloadProjection = {
	...streamingProjection,
	originalFilename: 1
} as const;

const ownerStorageProjection = {
	_id: 0,
	publicId: 1,
	storageKey: 1,
	coverImage: 1
} as const;

const coverDeliveryProjection = {
	_id: 0,
	publicId: 1,
	coverImage: 1
} as const;

const publicAggregateProjection = {
	_id: 0,
	publicId: 1,
	title: 1,
	artist: '$displayArtist',
	bpm: 1,
	musicalKey: 1,
	genre: 1,
	description: 1,
	fileSizeBytes: 1,
	coverImage: 1,
	ownerUsername: '$displayArtist',
	createdAt: 1,
	updatedAt: 1
} as const;

function duplicateTrackField(error: unknown): DuplicateTrackField | null {
	if (!(error instanceof MongoServerError) || error.code !== 11000) {
		return null;
	}
	const keyPattern = error.keyPattern as Record<string, unknown> | undefined;
	if (keyPattern && Object.hasOwn(keyPattern, 'publicId')) return 'publicId';
	if (keyPattern && Object.hasOwn(keyPattern, 'storageKey')) return 'storageKey';
	if (keyPattern && Object.hasOwn(keyPattern, '_id')) return 'id';
	return null;
}

function mapStreaming(document: TrackDocument): TrackForStreaming | null {
	if (document.visibility !== 'public') return null;
	return {
		id: document.publicId,
		storedFilename: document.storageKey,
		mimeType: document.mimeType,
		fileSizeBytes: document.fileSizeBytes,
		visibility: 'public'
	};
}

function mapDownload(document: TrackDocument): TrackForDownload | null {
	const stream = mapStreaming(document);
	return stream
		? { ...stream, originalFilename: document.originalFilename }
		: null;
}

function mapStoredCoverImage(value: unknown): StoredCoverImage | null {
	if (
		typeof value !== 'object' ||
		value === null ||
		!('storageKey' in value) ||
		!('mimeType' in value) ||
		!('byteSize' in value)
	) {
		return null;
	}

	const coverImage = value as {
		storageKey?: unknown;
		mimeType?: unknown;
		byteSize?: unknown;
	};

	if (
		typeof coverImage.storageKey !== 'string' ||
		typeof coverImage.mimeType !== 'string' ||
		!Number.isSafeInteger(coverImage.byteSize) ||
		(coverImage.byteSize as number) <= 0
	) {
		return null;
	}

	return {
		storageKey: coverImage.storageKey,
		mimeType: coverImage.mimeType,
		byteSize: coverImage.byteSize as number
	};
}

function mapCoverForDelivery(document: TrackDocument): TrackCoverForDelivery | null {
	const coverImage = mapStoredCoverImage(document.coverImage);
	return coverImage
		? {
				publicId: document.publicId,
				...coverImage
			}
		: null;
}

export async function initializeMongoPublicTrackIdCounter(
	counters: Collection<CounterDocument>,
	lastAllocatedPublicId = 0,
	options: MongoTrackRepositoryOptions = {}
): Promise<number> {
	if (!Number.isSafeInteger(lastAllocatedPublicId) || lastAllocatedPublicId < 0) {
		throw new Error('The initial public track ID counter must be a non-negative safe integer.');
	}
	const result = await counters.findOneAndUpdate(
		{ _id: TRACK_PUBLIC_ID_COUNTER },
		{ $max: { value: lastAllocatedPublicId } },
		{
			upsert: true,
			returnDocument: 'after',
			timeoutMS: options.timeoutMS ?? MONGODB_TRACK_OPERATION_TIMEOUT_MS,
			projection: { _id: 0, value: 1 }
		}
	);
	if (!result || !Number.isSafeInteger(result.value) || result.value < lastAllocatedPublicId) {
		throw new Error('MongoDB did not initialize the public track ID counter safely.');
	}
	return result.value;
}

export function createMongoTrackRepository(
	tracks: Collection<TrackDocument>,
	counters: Collection<CounterDocument>,
	users: Collection<UserDocument>,
	options: MongoTrackRepositoryOptions = {}
): TrackRepository {
	const timeoutMS = options.timeoutMS ?? MONGODB_TRACK_OPERATION_TIMEOUT_MS;
	const operationOptions = { timeoutMS, signal: options.signal };
	const findOptions = (projection: FindOptions['projection']): FindOptions => ({
		...operationOptions,
		projection
	});

	async function deleteTrackAndPlaylistItems(
		publicId: number,
		ownerId: string
	): Promise<boolean> {
		if (!options.client || !options.playlistItems) {
			const result = await tracks.deleteOne({ publicId, ownerId }, operationOptions);
			return result.deletedCount === 1;
		}
		const clientSession = options.client.startSession();
		let deleted = false;
		let completed = false;
		let primaryFailure: unknown;
		try {
			await clientSession.withTransaction(async () => {
				const track = await tracks.findOne(
					{ publicId, ownerId },
					{ ...operationOptions, session: clientSession, projection: { _id: 1 } }
				);
				if (!track) {
					deleted = false;
					completed = true;
					return;
				}
				const result = await tracks.deleteOne(
					{ _id: track._id, ownerId },
					{ ...operationOptions, session: clientSession }
				);
				if (result.deletedCount !== 1) {
					throw new Error('Owner-scoped track deletion changed concurrently.');
				}
				await options.playlistItems!.deleteMany(
					{ trackId: track._id },
					{ ...operationOptions, session: clientSession }
				);
				deleted = true;
				completed = true;
			}, {
				maxCommitTimeMS: TRACK_DELETE_TRANSACTION_TIMEOUT_MS,
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
				() => clientSession.endSession(),
				(error) => writeSafeLog({
					severity: 'error',
					category: 'shutdown',
					...safeErrorFields(error)
				})
			);
		}
		if (!completed) throw new Error('MongoDB track deletion transaction did not commit.');
		return deleted;
	}

	async function allocatePublicTrackId(): Promise<number> {
		const counter = await counters.findOneAndUpdate(
			{ _id: TRACK_PUBLIC_ID_COUNTER },
			{ $inc: { value: 1 } },
			{
				...operationOptions,
				upsert: true,
				returnDocument: 'after',
				projection: { _id: 0, value: 1 }
			}
		);
		if (!counter) {
			throw new Error('MongoDB did not return the allocated public track ID.');
		}
		assertPositivePublicTrackId(counter.value);
		return counter.value;
	}

	function publicQueryMatch(
		query: TrackSearchFilters
	): Record<string, unknown> {
		const match: Record<string, unknown> = { visibility: 'public' };
		if (query.bpmMin !== undefined || query.bpmMax !== undefined) {
			match.bpm = {
				...(query.bpmMin === undefined ? {} : { $gte: query.bpmMin }),
				...(query.bpmMax === undefined ? {} : { $lte: query.bpmMax })
			};
		}
		if (query.musicalKey) match.musicalKey = query.musicalKey;
		if (query.genre) match.genre = query.genre;
		return match;
	}

	function publicQuerySort(query: TrackSearchFilters) {
		switch (query.sort) {
			case 'oldest':
				return { createdAt: 1, publicId: 1 } as const;
			case 'title_asc':
				return { __sortTitle: 1, publicId: 1 } as const;
			case 'title_desc':
				return { __sortTitle: -1, publicId: 1 } as const;
			case 'bpm_asc':
				return { __bpmMissing: 1, bpm: 1, publicId: 1 } as const;
			case 'bpm_desc':
				return { __bpmMissing: 1, bpm: -1, publicId: 1 } as const;
			case 'newest':
				return { createdAt: -1, publicId: -1 } as const;
		}
	}

	async function publicAggregate(
		match: Record<string, unknown>,
		query: TrackSearchFilters = { sort: 'newest' }
	): Promise<PublicTrackAggregateRecord[]> {
		return tracks
			.aggregate<PublicTrackAggregateRecord>(
				[
					{ $match: { ...match, visibility: 'public' } },
					{
						$lookup: {
							from: users.collectionName,
							localField: 'ownerId',
							foreignField: '_id',
							as: 'owner',
							pipeline: [{ $project: { _id: 0, username: 1 } }]
						}
					},
					{ $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } },
					{
						$set: {
							displayArtist: { $ifNull: ['$owner.username', UNKNOWN_TRACK_UPLOADER] },
							__sortTitle: { $toLower: '$title' },
							__bpmMissing: {
								$cond: [{ $eq: ['$bpm', null] }, 1, 0]
							}
						}
					},
					...(query.q
						? [{
								$match: {
									$or: [
										{ title: new RegExp(escapeRegexSearchTerm(query.q), 'i') },
										{ displayArtist: new RegExp(escapeRegexSearchTerm(query.q), 'i') },
										{ description: new RegExp(escapeRegexSearchTerm(query.q), 'i') }
									]
								}
							}]
						: []),
					{ $sort: publicQuerySort(query) },
					{ $project: publicAggregateProjection }
				],
				operationOptions
			)
			.toArray();
	}

	async function ownerAggregate(
		match: Record<string, unknown>,
		limit = MONGODB_BASIC_PUBLIC_TRACK_LIMIT
	): Promise<OwnerTrackRecord[]> {
		return tracks.aggregate<OwnerTrackRecord>([
			{ $match: match },
			{ $sort: { createdAt: -1, publicId: -1 } },
			{ $limit: limit },
			{
				$lookup: {
					from: users.collectionName,
					localField: 'ownerId',
					foreignField: '_id',
					as: 'owner',
					pipeline: [{ $project: { _id: 0, username: 1 } }]
				}
			},
			{ $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } },
			{ $project: ownerAggregateProjection }
		], operationOptions).toArray();
	}

	return {
		async createTrack(input, createOptions) {
			requireTrackOwnerId(input.ownerId);
			const publicId = createOptions?.publicId ?? (await allocatePublicTrackId());
			assertPositivePublicTrackId(publicId);
			const document: TrackDocument = {
				_id: input.id,
				publicId,
				ownerId: input.ownerId,
				title: input.title,
				bpm: input.bpm,
				musicalKey: input.musicalKey,
				genre: input.genre,
				description: input.description,
				originalFilename: input.originalFilename,
				storageKey: input.storageKey,
				mimeType: input.mimeType,
				fileSizeBytes: input.fileSizeBytes,
				durationMs: null,
				coverImage: input.coverImage ?? null,
				visibility: createOptions?.visibility ?? 'public',
				createdAt: input.createdAt,
				updatedAt: input.updatedAt
			};
			try {
				await tracks.insertOne(document, operationOptions);
			} catch (error) {
				const field = duplicateTrackField(error);
				if (field) throw new DuplicateTrackError(field);
				throw error;
			}
			return { id: publicId, title: document.title, createdAt: document.createdAt };
		},

		allocatePublicTrackId,

		async findPublicTrackByPublicId(publicId) {
			assertPositivePublicTrackId(publicId);
			const [record] = await publicAggregate({ publicId });
			return record ? toPublicTrack(record) : null;
		},

		async listPublicTracks(query) {
			const records = await publicAggregate(publicQueryMatch(query), query);
			return records.map(toPublicTrack);
		},

		async findTrackForStreaming(publicId) {
			assertPositivePublicTrackId(publicId);
			const document = await tracks.findOne(
				{ publicId, visibility: 'public' },
				findOptions(streamingProjection)
			);
			return document ? mapStreaming(document) : null;
		},

		async findTrackForDownload(publicId) {
			assertPositivePublicTrackId(publicId);
			const document = await tracks.findOne(
				{ publicId, visibility: 'public' },
				findOptions(downloadProjection)
			);
			return document ? mapDownload(document) : null;
		},

		async findTrackCoverForAccess(publicId, requesterOwnerId) {
			assertPositivePublicTrackId(publicId);
			const normalizedOwnerId = requesterOwnerId?.trim();
			const document = await tracks.findOne(
				{
					publicId,
					...(normalizedOwnerId
						? {
								$or: [
									{ visibility: 'public' },
									{ ownerId: normalizedOwnerId }
								]
							}
						: { visibility: 'public' })
				},
				findOptions(coverDeliveryProjection)
			);
			return document ? mapCoverForDelivery(document) : null;
		},

		async listTracksForOwner(ownerId) {
			requireTrackOwnerId(ownerId);
			return (await ownerAggregate({ ownerId })).map(toOwnerTrack);
		},

		async findOwnerTrack(publicId, ownerId) {
			requireTrackOwnerId(ownerId);
			assertPositivePublicTrackId(publicId);
			const [record] = await ownerAggregate({ publicId, ownerId }, 1);
			return record ? toOwnerTrack(record) : null;
		},

		async updateOwnerTrackMetadata(publicId, ownerId, metadata) {
			requireTrackOwnerId(ownerId);
			assertPositivePublicTrackId(publicId);
			const update: UpdateOwnerTrackMetadataInput = {
				title: metadata.title,
				bpm: metadata.bpm,
				musicalKey: metadata.musicalKey,
				genre: metadata.genre,
				description: metadata.description,
				updatedAt: metadata.updatedAt,
				...(Object.hasOwn(metadata, 'coverImage')
					? { coverImage: metadata.coverImage ?? null }
					: {})
			};
			const document = await tracks.findOneAndUpdate(
				{ publicId, ownerId },
				{ $set: update },
				{
					...operationOptions,
					returnDocument: 'after',
					projection: { _id: 0, publicId: 1 }
				}
			);
			if (!document) return null;
			const [record] = await ownerAggregate({ publicId, ownerId }, 1);
			return record ? toOwnerTrack(record) : null;
		},

		async deleteOwnerTrack(publicId, ownerId) {
			requireTrackOwnerId(ownerId);
			assertPositivePublicTrackId(publicId);
			return deleteTrackAndPlaylistItems(publicId, ownerId);
		},

		async getOwnerTrackStorage(publicId, ownerId): Promise<OwnerTrackStorage | null> {
			requireTrackOwnerId(ownerId);
			assertPositivePublicTrackId(publicId);
			const document = await tracks.findOne(
				{ publicId, ownerId },
				findOptions(ownerStorageProjection)
			);
			return document
				? {
						publicId: document.publicId,
						storedFilename: document.storageKey,
						coverImage: mapStoredCoverImage(document.coverImage)
					}
				: null;
		}
	};
}

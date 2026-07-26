import { db } from '$lib/server/db';
import { tracks, users } from '$lib/server/db/schema';
import type { MusicGenre, MusicalKey } from '$lib/constants/music';
import type { TrackSearchFilters } from '$lib/tracks-query';
import type { OwnerTrack, PublicTrack } from '$lib/types';
import { and, asc, desc, eq, gte, lte, or, sql, type SQL } from 'drizzle-orm';
import { toOwnerTrack, type OwnerTrackRecord } from './owner-model';
import { toPublicTrack, type PublicTrackRecord } from './public-model';
import { escapeSqlLikeSearchTerm } from './query';
import type { ValidatedTrackMetadata } from './validation';

export interface CreateTrackInput {
	id: string;
	ownerId: string;
	title: string;
	artist: string;
	bpm: number | null;
	musicalKey: MusicalKey | null;
	genre: MusicGenre | null;
	description: string | null;
	originalFilename: string;
	storageKey: string;
	mimeType: string;
	fileSizeBytes: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface CreatedTrack {
	id: number;
	title: string;
	createdAt: Date;
}

export interface PublicTrackFile {
	id: number;
	storedFilename: string;
	originalFilename: string;
	mimeType: string;
	fileSizeBytes: number;
	visibility: 'public';
}

export interface OwnedTrackFile {
	publicId: number;
	storedFilename: string;
}

export interface UpdateOwnedTrackMetadataInput extends ValidatedTrackMetadata {
	updatedAt: Date;
}

const publicTrackSelection = {
	publicId: tracks.publicId,
	title: tracks.title,
	artist: tracks.artist,
	bpm: tracks.bpm,
	musicalKey: tracks.musicalKey,
	genre: tracks.genre,
	description: tracks.description,
	fileSizeBytes: tracks.fileSizeBytes,
	ownerUsername: users.username,
	createdAt: tracks.createdAt,
	updatedAt: tracks.updatedAt
};

const ownerTrackSelection = {
	publicId: tracks.publicId,
	title: tracks.title,
	artist: tracks.artist,
	bpm: tracks.bpm,
	musicalKey: tracks.musicalKey,
	genre: tracks.genre,
	description: tracks.description,
	visibility: tracks.visibility,
	fileSizeBytes: tracks.fileSizeBytes,
	mimeType: tracks.mimeType,
	originalFilename: tracks.originalFilename,
	createdAt: tracks.createdAt,
	updatedAt: tracks.updatedAt
};

type TrackDatabase = typeof db;

function requireOwnerId(ownerId: string): void {
	if (!ownerId.trim()) {
		throw new Error('An authenticated owner ID is required.');
	}
}

function publicTrackConditions(filters: TrackSearchFilters): SQL[] {
	const conditions: SQL[] = [eq(tracks.visibility, 'public')];

	if (filters.q) {
		const pattern = `%${escapeSqlLikeSearchTerm(filters.q)}%`;
		const textSearch = or(
			sql`lower(${tracks.title}) like lower(${pattern}) escape ${'\\'}`,
			sql`lower(${tracks.artist}) like lower(${pattern}) escape ${'\\'}`,
			sql`lower(${tracks.description}) like lower(${pattern}) escape ${'\\'}`
		);

		if (textSearch) {
			conditions.push(textSearch);
		}
	}

	if (filters.bpmMin !== undefined) {
		conditions.push(gte(tracks.bpm, filters.bpmMin));
	}

	if (filters.bpmMax !== undefined) {
		conditions.push(lte(tracks.bpm, filters.bpmMax));
	}

	if (filters.musicalKey) {
		conditions.push(eq(tracks.musicalKey, filters.musicalKey));
	}

	if (filters.genre) {
		conditions.push(eq(tracks.genre, filters.genre));
	}

	return conditions;
}

function publicTrackOrder(filters: TrackSearchFilters): SQL[] {
	switch (filters.sort) {
		case 'oldest':
			return [asc(tracks.createdAt), asc(tracks.publicId)];
		case 'title_asc':
			return [asc(sql`lower(${tracks.title})`), asc(tracks.publicId)];
		case 'bpm_asc':
			return [
				asc(sql`case when ${tracks.bpm} is null then 1 else 0 end`),
				asc(tracks.bpm),
				asc(tracks.publicId)
			];
		case 'bpm_desc':
			return [
				asc(sql`case when ${tracks.bpm} is null then 1 else 0 end`),
				desc(tracks.bpm),
				asc(tracks.publicId)
			];
		case 'newest':
			return [desc(tracks.createdAt), desc(tracks.publicId)];
	}
}

export async function createTrack(input: CreateTrackInput): Promise<CreatedTrack> {
	const [track] = await db
		.insert(tracks)
		.values({
			...input,
			visibility: 'public'
		})
		.returning({
			id: tracks.publicId,
			title: tracks.title,
			createdAt: tracks.createdAt
		});

	if (!track) {
		throw new Error('The database did not return the created track.');
	}

	return track;
}

export async function listPublicTracks(
	filters: TrackSearchFilters,
	database: TrackDatabase = db
): Promise<PublicTrack[]> {
	const records = await database
		.select(publicTrackSelection)
		.from(tracks)
		.innerJoin(users, eq(tracks.ownerId, users.id))
		.where(and(...publicTrackConditions(filters)))
		.orderBy(...publicTrackOrder(filters));

	return records.map((record) => toPublicTrack(record satisfies PublicTrackRecord));
}

export async function findPublicTrackById(id: number): Promise<PublicTrack | null> {
	const [record] = await db
		.select(publicTrackSelection)
		.from(tracks)
		.innerJoin(users, eq(tracks.ownerId, users.id))
		.where(and(eq(tracks.publicId, id), eq(tracks.visibility, 'public')))
		.limit(1);

	return record ? toPublicTrack(record satisfies PublicTrackRecord) : null;
}

export async function findPublicTrackFileById(id: number): Promise<PublicTrackFile | null> {
	const [record] = await db
		.select({
			id: tracks.publicId,
			storedFilename: tracks.storageKey,
			originalFilename: tracks.originalFilename,
			mimeType: tracks.mimeType,
			fileSizeBytes: tracks.fileSizeBytes,
			visibility: tracks.visibility
		})
		.from(tracks)
		.where(and(eq(tracks.publicId, id), eq(tracks.visibility, 'public')))
		.limit(1);

	return record?.visibility === 'public'
		? {
				...record,
				visibility: 'public'
			}
		: null;
}

export async function listTracksByOwner(
	ownerId: string,
	database: TrackDatabase = db
): Promise<OwnerTrack[]> {
	requireOwnerId(ownerId);

	const records = await database
		.select(ownerTrackSelection)
		.from(tracks)
		.where(eq(tracks.ownerId, ownerId))
		.orderBy(desc(tracks.createdAt), desc(tracks.publicId));

	return records.map((record) => toOwnerTrack(record satisfies OwnerTrackRecord));
}

export async function findOwnedTrackByPublicId(
	publicId: number,
	ownerId: string,
	database: TrackDatabase = db
): Promise<OwnerTrack | null> {
	requireOwnerId(ownerId);

	const [record] = await database
		.select(ownerTrackSelection)
		.from(tracks)
		.where(and(eq(tracks.publicId, publicId), eq(tracks.ownerId, ownerId)))
		.limit(1);

	return record ? toOwnerTrack(record satisfies OwnerTrackRecord) : null;
}

export async function updateOwnedTrackMetadata(
	publicId: number,
	ownerId: string,
	metadata: UpdateOwnedTrackMetadataInput,
	database: TrackDatabase = db
): Promise<OwnerTrack | null> {
	requireOwnerId(ownerId);

	const [record] = await database
		.update(tracks)
		.set(metadata)
		.where(and(eq(tracks.publicId, publicId), eq(tracks.ownerId, ownerId)))
		.returning(ownerTrackSelection);

	return record ? toOwnerTrack(record satisfies OwnerTrackRecord) : null;
}

export async function findOwnedTrackFileByPublicId(
	publicId: number,
	ownerId: string,
	database: TrackDatabase = db
): Promise<OwnedTrackFile | null> {
	requireOwnerId(ownerId);

	const [record] = await database
		.select({
			publicId: tracks.publicId,
			storedFilename: tracks.storageKey
		})
		.from(tracks)
		.where(and(eq(tracks.publicId, publicId), eq(tracks.ownerId, ownerId)))
		.limit(1);

	return record ?? null;
}

export async function deleteOwnedTrackRecord(
	publicId: number,
	ownerId: string,
	database: TrackDatabase = db
): Promise<boolean> {
	requireOwnerId(ownerId);

	const deleted = await database
		.delete(tracks)
		.where(and(eq(tracks.publicId, publicId), eq(tracks.ownerId, ownerId)))
		.returning({ publicId: tracks.publicId });

	return deleted.length === 1;
}

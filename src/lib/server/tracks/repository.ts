import { db } from '$lib/server/db';
import { tracks, users } from '$lib/server/db/schema';
import type { MusicGenre, MusicalKey } from '$lib/constants/music';
import type { PublicTrack } from '$lib/types';
import { and, desc, eq } from 'drizzle-orm';
import { toPublicTrack, type PublicTrackRecord } from './public-model';

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

export async function listPublicTracks(): Promise<PublicTrack[]> {
	const records = await db
		.select(publicTrackSelection)
		.from(tracks)
		.innerJoin(users, eq(tracks.ownerId, users.id))
		.where(eq(tracks.visibility, 'public'))
		.orderBy(desc(tracks.createdAt), desc(tracks.publicId));

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

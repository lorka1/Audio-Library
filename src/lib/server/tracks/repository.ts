import { db } from '$lib/server/db';
import { tracks } from '$lib/server/db/schema';
import type { MusicGenre, MusicalKey } from '$lib/constants/music';

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
	id: string;
	title: string;
	createdAt: Date;
}

export async function createTrack(input: CreateTrackInput): Promise<CreatedTrack> {
	const [track] = await db
		.insert(tracks)
		.values({
			...input,
			visibility: 'public'
		})
		.returning({
			id: tracks.id,
			title: tracks.title,
			createdAt: tracks.createdAt
		});

	if (!track) {
		throw new Error('The database did not return the created track.');
	}

	return track;
}

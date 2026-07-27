import type { PublicTrack } from '../../types';

export interface PublicTrackRecord {
	publicId: number;
	title: string;
	artist: string;
	bpm: number | null;
	musicalKey: string | null;
	genre: string | null;
	description: string | null;
	fileSizeBytes: number;
	ownerUsername: string;
	createdAt: Date;
	updatedAt: Date;
}

export function toPublicTrack(record: PublicTrackRecord): PublicTrack {
	return {
		id: record.publicId,
		title: record.title,
		artist: record.artist,
		bpm: record.bpm,
		musicalKey: record.musicalKey,
		genre: record.genre,
		description: record.description,
		fileSizeBytes: record.fileSizeBytes,
		ownerUsername: record.ownerUsername,
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString()
	};
}

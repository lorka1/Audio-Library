import type { OwnerTrack, TrackVisibility } from '../../types';

export interface OwnerTrackRecord {
	publicId: number;
	title: string;
	artist: string;
	bpm: number | null;
	musicalKey: string | null;
	genre: string | null;
	description: string | null;
	visibility: TrackVisibility;
	fileSizeBytes: number;
	mimeType: string;
	originalFilename: string;
	createdAt: Date;
	updatedAt: Date;
}

export function toOwnerTrack(record: OwnerTrackRecord): OwnerTrack {
	return {
		publicId: record.publicId,
		title: record.title,
		artist: record.artist,
		bpm: record.bpm,
		musicalKey: record.musicalKey,
		genre: record.genre,
		description: record.description,
		visibility: record.visibility,
		fileSizeBytes: record.fileSizeBytes,
		mimeType: record.mimeType,
		originalFilename: record.originalFilename,
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString()
	};
}

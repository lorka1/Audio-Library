import type { OwnerTrack, PublicTrack, TrackVisibility } from '../../types';
import type { StoredCoverImage } from './contract';

export interface OwnerTrackRecord {
	publicId: number;
	title: string;
	artist: string;
	coverImage?: StoredCoverImage | null;
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

export interface PublicTrackRecord {
	publicId: number;
	title: string;
	artist: string;
	coverImage?: StoredCoverImage | null;
	bpm: number | null;
	musicalKey: string | null;
	genre: string | null;
	description: string | null;
	fileSizeBytes: number;
	ownerUsername: string;
	createdAt: Date;
	updatedAt: Date;
}

function hasCoverImage(coverImage: StoredCoverImage | null | undefined): boolean {
	return (
		typeof coverImage?.storageKey === 'string' &&
		coverImage.storageKey.length > 0 &&
		typeof coverImage.mimeType === 'string' &&
		Number.isSafeInteger(coverImage.byteSize) &&
		coverImage.byteSize > 0
	);
}

export function toOwnerTrack(record: OwnerTrackRecord): OwnerTrack {
	return {
		publicId: record.publicId,
		title: record.title,
		artist: record.artist,
		coverImageUrl: hasCoverImage(record.coverImage)
			? `/api/tracks/${record.publicId}/cover`
			: null,
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

export function toPublicTrack(record: PublicTrackRecord): PublicTrack {
	return {
		id: record.publicId,
		title: record.title,
		artist: record.artist,
		coverImageUrl: hasCoverImage(record.coverImage)
			? `/api/tracks/${record.publicId}/cover`
			: null,
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

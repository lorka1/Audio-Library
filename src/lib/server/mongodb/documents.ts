import type { TrackVisibility } from '$lib/types';

/** Server-only documents must pass through an audience-safe projection before reaching a page. */
export interface UserDocument {
	_id: string;
	username: string;
	/** Normalized to trimmed lowercase. */
	email: string;
	passwordHash: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface SessionDocument {
	_id: string;
	tokenHash: string;
	userId: string;
	expiresAt: Date;
	createdAt: Date;
}

export interface TrackCoverImageDocument {
	storageKey: string;
	mimeType: string;
	byteSize: number;
}

export interface TrackDocument {
	_id: string;
	publicId: number;
	ownerId: string;
	title: string;
	/** Legacy client-supplied attribution. New writes omit it and reads ignore it. */
	artist?: string;
	bpm: number | null;
	musicalKey: string | null;
	genre: string | null;
	description: string | null;
	originalFilename: string;
	storageKey: string;
	mimeType: string;
	fileSizeBytes: number;
	durationMs: number | null;
	/** Legacy documents may omit this; new writes use validated private-storage metadata or null. */
	coverImage?: TrackCoverImageDocument | null;
	visibility: TrackVisibility;
	createdAt: Date;
	updatedAt: Date;
}

export interface PlaylistDocument {
	_id: string;
	/** Opaque identifier used in owner-scoped playlist URLs. */
	publicId: string;
	ownerId: string;
	name: string;
	description: string | null;
	/** Older playlists legitimately omit this optional private-image metadata. */
	image?: TrackCoverImageDocument | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface PlaylistItemDocument {
	_id: string;
	playlistId: string;
	trackId: string;
	addedAt: Date;
}

export const TRACK_PUBLIC_ID_COUNTER = 'tracks.publicId' as const;

export interface CounterDocument {
	_id: typeof TRACK_PUBLIC_ID_COUNTER;
	value: number;
}

export interface HistoricalMigrationDocument {
	_id: string;
	version: 1;
	userCount: number;
	trackCount: number;
	maxPublicId: number;
	fingerprint: string;
	completedAt: Date;
}

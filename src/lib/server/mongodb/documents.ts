import type { TrackVisibility } from '$lib/types';

/**
 * Server-only database documents. These must be mapped through the existing
 * public, owner-safe, account-safe, or navigation-safe projections before
 * being returned to Svelte pages.
 */
export interface UserDocument {
	/** Existing internal user UUID. */
	_id: string;
	/** Trimmed username stored by the current registration flow. */
	username: string;
	/** Trimmed, lowercase email stored by the current registration flow. */
	email: string;
	passwordHash: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface SessionDocument {
	/** Existing internal session UUID. */
	_id: string;
	tokenHash: string;
	userId: string;
	expiresAt: Date;
	createdAt: Date;
}

export interface TrackDocument {
	/** Existing internal track UUID. */
	_id: string;
	publicId: number;
	ownerId: string;
	title: string;
	artist: string;
	bpm: number | null;
	musicalKey: string | null;
	genre: string | null;
	description: string | null;
	originalFilename: string;
	storageKey: string;
	mimeType: string;
	fileSizeBytes: number;
	durationMs: number | null;
	visibility: TrackVisibility;
	createdAt: Date;
	updatedAt: Date;
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

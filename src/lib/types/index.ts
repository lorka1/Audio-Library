export const USER_ROLES = ['user', 'admin'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export function normalizeUserRole(value: unknown): UserRole {
	return value === 'admin' ? 'admin' : 'user';
}

export interface CurrentUser {
	id: string;
	username: string;
	email: string;
	role: UserRole;
	createdAt: Date;
}

export interface NavigationUser {
	username: string;
	role: UserRole;
}

export interface TrackSummary {
	id: number;
	title: string;
	artist: string;
	coverImageUrl: string | null;
	bpm: number | null;
	musicalKey: string | null;
	genre: string | null;
	description: string | null;
	fileSizeBytes: number;
	ownerUsername: string;
	createdAt: string;
	updatedAt: string;
}

export interface OwnerTrack {
	publicId: number;
	title: string;
	artist: string;
	coverImageUrl: string | null;
	bpm: number | null;
	musicalKey: string | null;
	genre: string | null;
	description: string | null;
	fileSizeBytes: number;
	mimeType: string;
	originalFilename: string;
	createdAt: string;
	updatedAt: string;
}

export interface PlaylistSummary {
	publicId: string;
	name: string;
	description: string | null;
	imageUrl: string | null;
	trackCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface PlaylistTrack {
	id: number;
	title: string;
	artist: string;
	coverImageUrl: string | null;
	bpm: number | null;
	musicalKey: string | null;
	genre: string | null;
	description: string | null;
	addedAt: string;
}

export interface OwnerPlaylist extends PlaylistSummary {
	tracks: PlaylistTrack[];
	unavailableTrackCount: number;
}

export interface PlaylistPickerEntry {
	publicId: string;
	name: string;
	imageUrl?: string | null;
	containsTrack: boolean;
}

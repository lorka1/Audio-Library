export const TRACK_VISIBILITIES = ['private', 'public'] as const;

export type TrackVisibility = (typeof TRACK_VISIBILITIES)[number];

export interface NavigationItem {
	label: string;
	href: string;
}

export interface CurrentUser {
	id: string;
	username: string;
	email: string;
	createdAt: Date;
}

export interface NavigationUser {
	username: string;
}

export interface PublicTrack {
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
	visibility: TrackVisibility;
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
	visibility: TrackVisibility;
	addedAt: string;
}

export interface OwnerPlaylist extends PlaylistSummary {
	tracks: PlaylistTrack[];
	unavailableTrackCount: number;
}

export interface PlaylistPickerEntry {
	publicId: string;
	name: string;
	containsTrack: boolean;
}

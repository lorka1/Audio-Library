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

export interface PublicTrack {
	id: number;
	title: string;
	artist: string;
	bpm: number | null;
	musicalKey: string | null;
	genre: string | null;
	description: string | null;
	fileSizeBytes: number;
	ownerUsername: string;
	createdAt: string;
	updatedAt: string;
}

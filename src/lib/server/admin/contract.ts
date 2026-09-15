import type { TrackVisibility, UserRole } from '$lib/types';

export interface AdminDashboardStats {
	totalUsers: number;
	totalTracks: number;
	publicTracks: number;
	privateTracks: number;
	totalPlaylists: number;
}

export interface AdminUserSummary {
	username: string;
	email: string;
	role: UserRole;
	createdAt: string;
	uploadedTrackCount: number;
}

export interface AdminTrackSummary {
	publicId: number;
	title: string;
	artist: string;
	ownerUsername: string;
	visibility: TrackVisibility;
	createdAt: string;
}

export interface AdminRepository {
	getDashboardStats(): Promise<AdminDashboardStats>;
	listUsers(): Promise<AdminUserSummary[]>;
	listTracks(): Promise<AdminTrackSummary[]>;
	findTrackOwnerId(publicId: number): Promise<string | null>;
}

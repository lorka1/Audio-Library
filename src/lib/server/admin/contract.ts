import type { UserRole } from '$lib/types';
import type { StoredCoverImage } from '../tracks/contract';

export interface AdminDashboardStats {
	totalUsers: number;
	totalTracks: number;
	totalPlaylists: number;
}

export interface AdminUserSummary {
	id: string;
	username: string;
	email: string;
	role: UserRole;
	createdAt: string;
	uploadedTrackCount: number;
}

export interface AdminUserDeletionSnapshot {
	userId: string;
	username: string;
	tracks: {
		id: string;
		publicId: number;
		storedFilename: string;
		coverImage: StoredCoverImage | null;
	}[];
	playlists: { id: string; imageStorageKey: string | null }[];
}

export class UserDeletionChangedError extends Error {
	constructor() {
		super('The user data changed during deletion.');
		this.name = 'UserDeletionChangedError';
	}
}

export interface AdminTrackSummary {
	publicId: number;
	title: string;
	artist: string;
	ownerUsername: string;
	createdAt: string;
}

export interface AdminRepository {
	getDashboardStats(): Promise<AdminDashboardStats>;
	listUsers(): Promise<AdminUserSummary[]>;
	findUserDeletionSnapshot(userId: string): Promise<AdminUserDeletionSnapshot | null>;
	deleteUserCascade(snapshot: AdminUserDeletionSnapshot): Promise<boolean>;
	listTracks(): Promise<AdminTrackSummary[]>;
	findTrackOwnerId(publicId: number): Promise<string | null>;
}

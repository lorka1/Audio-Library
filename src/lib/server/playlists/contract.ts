import type { ClientSession } from 'mongodb';
import type {
	OwnerPlaylist,
	PlaylistSummary
} from '../../types/index.ts';

export interface PlaylistInput {
	name: string;
	description: string | null;
	image?: StoredPlaylistImage | null;
}

export interface StoredPlaylistImage {
	storageKey: string;
	mimeType: string;
	byteSize: number;
}

export interface OwnerPlaylistImageStorage {
	publicId: string;
	image: StoredPlaylistImage | null;
}

export type AddTrackToPlaylistResult =
	| 'added'
	| 'already-added'
	| 'not-found'
	| 'track-unavailable';

export type RemoveTrackFromPlaylistResult =
	| 'removed'
	| 'not-present'
	| 'not-found';

export interface PlaylistRepository {
	createPlaylist(ownerId: string, input: PlaylistInput): Promise<PlaylistSummary>;
	listPlaylistsForOwner(ownerId: string): Promise<PlaylistSummary[]>;
	findPlaylistForOwner(ownerId: string, publicId: string): Promise<OwnerPlaylist | null>;
	updatePlaylistForOwner(
		ownerId: string,
		publicId: string,
		input: PlaylistInput
	): Promise<PlaylistSummary | null>;
	deletePlaylistForOwner(ownerId: string, publicId: string): Promise<boolean>;
	findPlaylistImageForOwner(ownerId: string, publicId: string): Promise<StoredPlaylistImage | null>;
	findPlaylistImageStorageForOwner(ownerId: string, publicId: string): Promise<OwnerPlaylistImageStorage | null>;
	addTrackToPlaylist(
		ownerId: string,
		playlistPublicId: string,
		trackPublicId: number
	): Promise<AddTrackToPlaylistResult>;
	removeTrackFromPlaylist(
		ownerId: string,
		playlistPublicId: string,
		trackPublicId: number
	): Promise<RemoveTrackFromPlaylistResult>;
	getTrackPlaylistMembership(ownerId: string, trackPublicId: number): Promise<string[]>;
	getTrackPlaylistMemberships(
		ownerId: string,
		trackPublicIds: number[]
	): Promise<Record<string, string[]>>;
	deleteItemsForTrack(trackId: string, session: ClientSession): Promise<number>;
}

export function requirePlaylistOwnerId(ownerId: string): void {
	if (!ownerId.trim()) throw new Error('An authenticated playlist owner is required.');
}

import type { MusicGenre, MusicalKey } from '../../constants/music';
import type { OwnerTrack, PublicTrack, TrackVisibility } from '../../types';
import type { TrackSearchFilters } from '../../tracks-query';
import type { ValidatedTrackMetadata } from './validation';

export interface StoredCoverImage {
	storageKey: string;
	mimeType: string;
	byteSize: number;
}

export interface CreateTrackInput {
	id: string;
	ownerId: string;
	title: string;
	bpm: number | null;
	musicalKey: MusicalKey | null;
	genre: MusicGenre | null;
	description: string | null;
	originalFilename: string;
	storageKey: string;
	mimeType: string;
	fileSizeBytes: number;
	coverImage?: StoredCoverImage | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface CreateTrackOptions {
	/** Only isolated repository checks set this; normal creation allocates a never-reused ID. */
	publicId?: number;
	visibility?: TrackVisibility;
}

export interface CreatedTrack {
	id: number;
	title: string;
	createdAt: Date;
}

export interface TrackForStreaming {
	id: number;
	storedFilename: string;
	mimeType: string;
	fileSizeBytes: number;
	visibility: 'public';
}

export interface TrackForDownload extends TrackForStreaming {
	originalFilename: string;
}

export interface OwnerTrackStorage {
	publicId: number;
	storedFilename: string;
	coverImage: StoredCoverImage | null;
}

export interface UpdateOwnerTrackMetadataInput extends ValidatedTrackMetadata {
	/** Omitted preserves the cover; null removes it; a value replaces it. Storage stays external. */
	coverImage?: StoredCoverImage | null;
	updatedAt: Date;
}

export interface TrackCoverForDelivery extends StoredCoverImage {
	publicId: number;
}

export type DuplicateTrackField = 'publicId' | 'storageKey' | 'id';

export class DuplicateTrackError extends Error {
	readonly field: DuplicateTrackField;

	constructor(field: DuplicateTrackField) {
		super('A track with the same unique value already exists.');
		this.name = 'DuplicateTrackError';
		this.field = field;
	}
}

export interface TrackRepository {
	createTrack(input: CreateTrackInput, options?: CreateTrackOptions): Promise<CreatedTrack>;
	allocatePublicTrackId(): Promise<number>;
	findPublicTrackByPublicId(publicId: number): Promise<PublicTrack | null>;
	listPublicTracks(query: TrackSearchFilters): Promise<PublicTrack[]>;
	findTrackForStreaming(publicId: number): Promise<TrackForStreaming | null>;
	findTrackForDownload(publicId: number): Promise<TrackForDownload | null>;
	findTrackCoverForAccess(
		publicId: number,
		requesterOwnerId?: string | null
	): Promise<TrackCoverForDelivery | null>;
	listTracksForOwner(ownerId: string): Promise<OwnerTrack[]>;
	findOwnerTrack(publicId: number, ownerId: string): Promise<OwnerTrack | null>;
	updateOwnerTrackMetadata(
		publicId: number,
		ownerId: string,
		metadata: UpdateOwnerTrackMetadataInput
	): Promise<OwnerTrack | null>;
	deleteOwnerTrack(publicId: number, ownerId: string): Promise<boolean>;
	getOwnerTrackStorage(publicId: number, ownerId: string): Promise<OwnerTrackStorage | null>;
}

export const UNKNOWN_TRACK_UPLOADER = 'Unknown uploader' as const;

export function requireTrackOwnerId(ownerId: string): void {
	if (!ownerId.trim()) {
		throw new Error('An authenticated owner ID is required.');
	}
}

export function assertPositivePublicTrackId(publicId: number): void {
	if (!Number.isSafeInteger(publicId) || publicId < 1) {
		throw new Error('Track public ID must be a positive safe integer.');
	}
}

import type { PublicTrack } from '$lib/types';

export interface PublicPlayerTrack {
	id: number;
	title: string;
	artist: string;
	streamUrl: string;
	detailsUrl: string;
}

export type PlayerTrackSource = Pick<PublicTrack, 'id' | 'title' | 'artist'>;

export function toPublicPlayerTrack(track: PlayerTrackSource): PublicPlayerTrack {
	return {
		id: track.id,
		title: track.title,
		artist: track.artist,
		streamUrl: `/api/tracks/${track.id}/stream`,
		detailsUrl: `/tracks/${track.id}`
	};
}

export function formatPlaybackTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) {
		return '0:00';
	}

	const wholeSeconds = Math.floor(seconds);
	const minutes = Math.floor(wholeSeconds / 60);
	const remainder = wholeSeconds % 60;

	return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

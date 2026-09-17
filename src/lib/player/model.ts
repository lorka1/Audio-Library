import type { TrackSummary } from '$lib/types';

export interface PlayerTrack {
	id: number;
	title: string;
	artist: string;
	coverImageUrl: string | null;
	streamUrl: string;
	detailsUrl: string;
}

export type PlayerTrackSource = Pick<
	TrackSummary,
	'id' | 'title' | 'artist' | 'coverImageUrl'
>;

export function toPlayerTrack(track: PlayerTrackSource): PlayerTrack {
	return {
		id: track.id,
		title: track.title,
		artist: track.artist,
		coverImageUrl: track.coverImageUrl,
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

import type { MusicGenre, MusicalKey } from '$lib/constants/music';

export const TRACK_SORTS = [
	'newest',
	'oldest',
	'title_asc',
	'title_desc',
	'bpm_asc',
	'bpm_desc'
] as const;

export type TrackSort = (typeof TRACK_SORTS)[number];

export const DEFAULT_TRACK_SORT: TrackSort = 'newest';

export const TRACK_SORT_OPTIONS = [
	{ value: 'newest', label: 'Newest first' },
	{ value: 'oldest', label: 'Oldest first' },
	{ value: 'title_asc', label: 'Title A\u2013Z' },
	{ value: 'title_desc', label: 'Title Z\u2013A' },
	{ value: 'bpm_asc', label: 'BPM low to high' },
	{ value: 'bpm_desc', label: 'BPM high to low' }
] as const satisfies ReadonlyArray<{ value: TrackSort; label: string }>;

export interface TrackSearchFilters {
	q?: string;
	bpmMin?: number;
	bpmMax?: number;
	musicalKey?: MusicalKey;
	genre?: MusicGenre;
	sort: TrackSort;
}

export interface TrackFilterValues {
	q: string;
	bpmMin: string;
	bpmMax: string;
	musicalKey: string;
	genre: string;
	sort: TrackSort;
}

export type TrackQueryErrorField =
	| 'q'
	| 'bpmMin'
	| 'bpmMax'
	| 'bpmRange'
	| 'musicalKey'
	| 'genre';

export type TrackQueryErrors = Partial<Record<TrackQueryErrorField, string>>;

export interface ParsedTrackQuery {
	filters: TrackSearchFilters;
	values: TrackFilterValues;
	errors: TrackQueryErrors;
	isValid: boolean;
}

export function isTrackSort(value: string): value is TrackSort {
	return TRACK_SORTS.some((sort) => sort === value);
}

export function escapeRegexSearchTerm(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildCanonicalTrackQuery(filters: TrackSearchFilters): string {
	const parameters = new URLSearchParams();

	if (filters.q) {
		parameters.set('q', filters.q);
	}

	if (filters.bpmMin !== undefined) {
		parameters.set('bpmMin', String(filters.bpmMin));
	}

	if (filters.bpmMax !== undefined) {
		parameters.set('bpmMax', String(filters.bpmMax));
	}

	if (filters.musicalKey) {
		parameters.set('musicalKey', filters.musicalKey);
	}

	if (filters.genre) {
		parameters.set('genre', filters.genre);
	}

	if (filters.sort !== DEFAULT_TRACK_SORT) {
		parameters.set('sort', filters.sort);
	}

	const query = parameters.toString();
	return query ? `?${query}` : '';
}

export function hasActiveTrackFilters(filters: TrackSearchFilters): boolean {
	return Boolean(
		filters.q ||
			filters.bpmMin !== undefined ||
			filters.bpmMax !== undefined ||
			filters.musicalKey ||
			filters.genre ||
			filters.sort !== DEFAULT_TRACK_SORT
	);
}

export function getActiveTrackFilterSummary(filters: TrackSearchFilters): string[] {
	const summary: string[] = [];

	if (filters.q) {
		summary.push(`Search: ${filters.q}`);
	}

	if (filters.bpmMin !== undefined && filters.bpmMax !== undefined) {
		summary.push(`BPM: ${filters.bpmMin}\u2013${filters.bpmMax}`);
	} else if (filters.bpmMin !== undefined) {
		summary.push(`BPM: ${filters.bpmMin} or higher`);
	} else if (filters.bpmMax !== undefined) {
		summary.push(`BPM: up to ${filters.bpmMax}`);
	}

	if (filters.musicalKey) {
		summary.push(`Key: ${filters.musicalKey}`);
	}

	if (filters.genre) {
		summary.push(`Genre: ${filters.genre}`);
	}

	if (filters.sort !== DEFAULT_TRACK_SORT) {
		const sortOption = TRACK_SORT_OPTIONS.find((option) => option.value === filters.sort);
		summary.push(`Sort: ${sortOption?.label ?? 'Newest first'}`);
	}

	return summary;
}

export function formatTrackResultCount(count: number): string {
	return `${count} ${count === 1 ? 'track' : 'tracks'} found`;
}

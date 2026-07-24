import {
	BPM_MAX,
	BPM_MIN,
	MUSIC_GENRES,
	MUSICAL_KEYS,
	type MusicGenre,
	type MusicalKey
} from '$lib/constants/music';
import {
	DEFAULT_TRACK_SORT,
	isTrackSort,
	type ParsedTrackQuery,
	type TrackFilterValues,
	type TrackQueryErrors,
	type TrackSearchFilters
} from '$lib/tracks-query';
export const TRACK_SEARCH_MAX_LENGTH = 100;

const CANONICAL_INTEGER_PATTERN = /^(?:0|[1-9]\d*)$/;
const musicalKeySet = new Set<string>(MUSICAL_KEYS);
const musicGenreSet = new Set<string>(MUSIC_GENRES);

interface ParsedBpm {
	value: number | undefined;
	error: string | undefined;
}

function boundedDisplayValue(value: string, maximumLength = TRACK_SEARCH_MAX_LENGTH): string {
	return value.slice(0, maximumLength);
}

function parseBpm(value: string, label: 'Minimum' | 'Maximum'): ParsedBpm {
	if (!value) {
		return { value: undefined, error: undefined };
	}

	if (!CANONICAL_INTEGER_PATTERN.test(value)) {
		return {
			value: undefined,
			error: `${label} BPM must be an integer between ${BPM_MIN} and ${BPM_MAX}.`
		};
	}

	const bpm = Number(value);

	if (!Number.isSafeInteger(bpm) || bpm < BPM_MIN || bpm > BPM_MAX) {
		return {
			value: undefined,
			error: `${label} BPM must be an integer between ${BPM_MIN} and ${BPM_MAX}.`
		};
	}

	return { value: bpm, error: undefined };
}

export function escapeSqlLikeSearchTerm(value: string): string {
	return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

export function parseTrackQuery(searchParams: URLSearchParams): ParsedTrackQuery {
	const rawQuery = (searchParams.get('q') ?? '').trim();
	const rawBpmMin = (searchParams.get('bpmMin') ?? '').trim();
	const rawBpmMax = (searchParams.get('bpmMax') ?? '').trim();
	const rawMusicalKey = (searchParams.get('musicalKey') ?? '').trim();
	const rawGenre = (searchParams.get('genre') ?? '').trim();
	const rawSort = (searchParams.get('sort') ?? '').trim();
	const sort = isTrackSort(rawSort) ? rawSort : DEFAULT_TRACK_SORT;

	const values: TrackFilterValues = {
		q: boundedDisplayValue(rawQuery),
		bpmMin: boundedDisplayValue(rawBpmMin, 32),
		bpmMax: boundedDisplayValue(rawBpmMax, 32),
		musicalKey: boundedDisplayValue(rawMusicalKey),
		genre: boundedDisplayValue(rawGenre),
		sort
	};
	const filters: TrackSearchFilters = { sort };
	const errors: TrackQueryErrors = {};

	if (rawQuery.length > TRACK_SEARCH_MAX_LENGTH) {
		errors.q = `Search must be at most ${TRACK_SEARCH_MAX_LENGTH} characters.`;
	} else if (rawQuery) {
		filters.q = rawQuery;
	}

	const bpmMin = parseBpm(rawBpmMin, 'Minimum');
	const bpmMax = parseBpm(rawBpmMax, 'Maximum');

	if (bpmMin.error) {
		errors.bpmMin = bpmMin.error;
	} else if (bpmMin.value !== undefined) {
		filters.bpmMin = bpmMin.value;
	}

	if (bpmMax.error) {
		errors.bpmMax = bpmMax.error;
	} else if (bpmMax.value !== undefined) {
		filters.bpmMax = bpmMax.value;
	}

	if (
		bpmMin.value !== undefined &&
		bpmMax.value !== undefined &&
		bpmMin.value > bpmMax.value
	) {
		errors.bpmRange = 'Minimum BPM cannot be greater than maximum BPM.';
	}

	if (rawMusicalKey) {
		if (musicalKeySet.has(rawMusicalKey)) {
			filters.musicalKey = rawMusicalKey as MusicalKey;
		} else {
			errors.musicalKey = 'The selected musical key is not valid.';
		}
	}

	if (rawGenre) {
		if (musicGenreSet.has(rawGenre)) {
			filters.genre = rawGenre as MusicGenre;
		} else {
			errors.genre = 'The selected genre is not valid.';
		}
	}

	return {
		filters,
		values,
		errors,
		isValid: Object.keys(errors).length === 0
	};
}

export type {
	ParsedTrackQuery,
	TrackQueryErrors,
	TrackSearchFilters,
	TrackSort
} from '$lib/tracks-query';

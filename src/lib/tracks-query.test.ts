import { describe, expect, it } from 'vitest';
import {
	buildCanonicalTrackQuery,
	DEFAULT_TRACK_SORT,
	formatTrackResultCount,
	getActiveTrackFilterSummary,
	hasActiveTrackFilters,
	isTrackSort,
	TRACK_SORT_OPTIONS,
	TRACK_SORTS,
	type TrackSearchFilters,
	type TrackSort
} from './tracks-query';

function filters(overrides: Partial<TrackSearchFilters> = {}): TrackSearchFilters {
	return {
		sort: DEFAULT_TRACK_SORT,
		...overrides
	};
}

describe('isTrackSort', () => {
	it.each(TRACK_SORTS)('recognizes supported sort %s', (sort) => {
		expect(isTrackSort(sort)).toBe(true);
	});

	it.each(['', 'NEWEST', 'newest ', 'title_desc', 'bpm', 'unknown'])(
		'rejects unsupported sort %j',
		(value) => {
			expect(isTrackSort(value)).toBe(false);
		}
	);
});

describe('buildCanonicalTrackQuery', () => {
	it('omits the default state entirely', () => {
		expect(buildCanonicalTrackQuery(filters())).toBe('');
	});

	it('uses a stable field order and URL-encodes every value', () => {
		expect(
			buildCanonicalTrackQuery(
				filters({
					q: 'drum & bass',
					bpmMin: 100,
					bpmMax: 174,
					musicalKey: 'C# minor / Db minor',
					genre: 'Drum and Bass',
					sort: 'title_asc'
				})
			)
		).toBe(
			'?q=drum+%26+bass&bpmMin=100&bpmMax=174&musicalKey=C%23+minor+%2F+Db+minor&genre=Drum+and+Bass&sort=title_asc'
		);
	});

	it.each([
		[filters({ q: 'night drive' }), '?q=night+drive'],
		[filters({ bpmMin: 20 }), '?bpmMin=20'],
		[filters({ bpmMax: 300 }), '?bpmMax=300'],
		[filters({ musicalKey: 'A minor' }), '?musicalKey=A+minor'],
		[filters({ genre: 'Hip-Hop' }), '?genre=Hip-Hop']
	] as const)('builds the canonical query for one filter', (input, expected) => {
		expect(buildCanonicalTrackQuery(input)).toBe(expected);
	});

	it.each(TRACK_SORTS)('canonicalizes sort %s', (sort) => {
		const expected = sort === DEFAULT_TRACK_SORT ? '' : `?sort=${sort}`;
		expect(buildCanonicalTrackQuery(filters({ sort }))).toBe(expected);
	});

	it('does not include empty optional strings', () => {
		expect(
			buildCanonicalTrackQuery({
				q: '',
				musicalKey: undefined,
				genre: undefined,
				sort: DEFAULT_TRACK_SORT
			})
		).toBe('');
	});
});

describe('hasActiveTrackFilters', () => {
	it('returns false for the default state', () => {
		expect(hasActiveTrackFilters(filters())).toBe(false);
	});

	it.each([
		['search', filters({ q: 'mix' })],
		['minimum BPM', filters({ bpmMin: 20 })],
		['maximum BPM', filters({ bpmMax: 300 })],
		['musical key', filters({ musicalKey: 'C major' })],
		['genre', filters({ genre: 'Electronic' })],
		['non-default sort', filters({ sort: 'oldest' })]
	] as const)('detects active %s', (_label, input) => {
		expect(hasActiveTrackFilters(input)).toBe(true);
	});

	it.each(TRACK_SORTS)('handles sort activity for %s', (sort) => {
		expect(hasActiveTrackFilters(filters({ sort }))).toBe(sort !== DEFAULT_TRACK_SORT);
	});
});

describe('getActiveTrackFilterSummary', () => {
	it('returns no labels for the default state', () => {
		expect(getActiveTrackFilterSummary(filters())).toEqual([]);
	});

	it('formats a search term', () => {
		expect(getActiveTrackFilterSummary(filters({ q: 'night drive' }))).toEqual([
			'Search: night drive'
		]);
	});

	it.each([
		[filters({ bpmMin: 100, bpmMax: 140 }), ['BPM: 100–140']],
		[filters({ bpmMin: 100 }), ['BPM: 100 or higher']],
		[filters({ bpmMax: 140 }), ['BPM: up to 140']]
	] as const)('formats BPM bounds', (input, expected) => {
		expect(getActiveTrackFilterSummary(input)).toEqual(expected);
	});

	it('formats musical key and genre', () => {
		expect(
			getActiveTrackFilterSummary(
				filters({ musicalKey: 'F# minor / Gb minor', genre: 'Drum and Bass' })
			)
		).toEqual(['Key: F# minor / Gb minor', 'Genre: Drum and Bass']);
	});

	it.each(
		TRACK_SORT_OPTIONS.filter(
			(option): option is (typeof TRACK_SORT_OPTIONS)[number] & { value: Exclude<TrackSort, 'newest'> } =>
				option.value !== DEFAULT_TRACK_SORT
		)
	)('formats non-default sort $value', ({ value, label }) => {
		expect(getActiveTrackFilterSummary(filters({ sort: value }))).toEqual([
			`Sort: ${label}`
		]);
	});

	it('keeps the summary in canonical display order', () => {
		expect(
			getActiveTrackFilterSummary(
				filters({
					q: 'night drive',
					bpmMin: 100,
					bpmMax: 140,
					musicalKey: 'C minor',
					genre: 'Electronic',
					sort: 'oldest'
				})
			)
		).toEqual([
			'Search: night drive',
			'BPM: 100–140',
			'Key: C minor',
			'Genre: Electronic',
			'Sort: Oldest first'
		]);
	});
});

describe('formatTrackResultCount', () => {
	it.each([
		[0, '0 tracks found'],
		[1, '1 track found'],
		[2, '2 tracks found'],
		[1_000, '1000 tracks found']
	] as const)('formats %i as %s', (count, expected) => {
		expect(formatTrackResultCount(count)).toBe(expected);
	});
});

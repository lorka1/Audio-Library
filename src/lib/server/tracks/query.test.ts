import { describe, expect, it } from 'vitest';
import { BPM_MAX, BPM_MIN, MUSIC_GENRES, MUSICAL_KEYS } from '$lib/constants/music';
import { DEFAULT_TRACK_SORT, TRACK_SORTS } from '$lib/tracks-query';
import {
	escapeSqlLikeSearchTerm,
	parseTrackQuery,
	TRACK_SEARCH_MAX_LENGTH
} from './query';

function query(parameters = '') {
	return parseTrackQuery(new URLSearchParams(parameters));
}

describe('escapeSqlLikeSearchTerm', () => {
	it.each([
		['', ''],
		['ordinary text', 'ordinary text'],
		['%', String.raw`\%`],
		['_', String.raw`\_`],
		['\\', String.raw`\\`],
		['100% complete', String.raw`100\% complete`],
		['under_score', String.raw`under\_score`],
		['%_\\', String.raw`\%\_\\`],
		['\\%_', String.raw`\\\%\_`],
		['čćž šđ', 'čćž šđ']
	])('escapes LIKE search term %j as %j', (input, expected) => {
		expect(escapeSqlLikeSearchTerm(input)).toBe(expected);
	});
});

describe('parseTrackQuery', () => {
	it('returns canonical empty defaults', () => {
		expect(query()).toEqual({
			filters: { sort: DEFAULT_TRACK_SORT },
			values: {
				q: '',
				bpmMin: '',
				bpmMax: '',
				musicalKey: '',
				genre: '',
				sort: DEFAULT_TRACK_SORT
			},
			errors: {},
			isValid: true
		});
	});

	it('trims and accepts every supported filter together', () => {
		expect(
			query(
				'q=++night+drive++&bpmMin=+100+&bpmMax=+140+&musicalKey=+C+minor+&genre=+Electronic+&sort=+oldest+'
			)
		).toEqual({
			filters: {
				q: 'night drive',
				bpmMin: 100,
				bpmMax: 140,
				musicalKey: 'C minor',
				genre: 'Electronic',
				sort: 'oldest'
			},
			values: {
				q: 'night drive',
				bpmMin: '100',
				bpmMax: '140',
				musicalKey: 'C minor',
				genre: 'Electronic',
				sort: 'oldest'
			},
			errors: {},
			isValid: true
		});
	});

	it('treats whitespace-only values as absent', () => {
		const result = query(
			'q=+++&bpmMin=+++&bpmMax=+++&musicalKey=+++&genre=+++&sort=+++'
		);

		expect(result.filters).toEqual({ sort: DEFAULT_TRACK_SORT });
		expect(result.errors).toEqual({});
		expect(result.isValid).toBe(true);
	});

	it('accepts a search term at the maximum length', () => {
		const search = 'a'.repeat(TRACK_SEARCH_MAX_LENGTH);
		const result = query(`q=${search}`);

		expect(result.filters.q).toBe(search);
		expect(result.values.q).toBe(search);
		expect(result.errors).toEqual({});
		expect(result.isValid).toBe(true);
	});

	it('rejects an overlong search and bounds the reflected display value', () => {
		const search = 'a'.repeat(TRACK_SEARCH_MAX_LENGTH + 20);
		const result = query(`q=${search}`);

		expect(result.filters).not.toHaveProperty('q');
		expect(result.values.q).toBe('a'.repeat(TRACK_SEARCH_MAX_LENGTH));
		expect(result.errors.q).toBe(
			`Search must be at most ${TRACK_SEARCH_MAX_LENGTH} characters.`
		);
		expect(result.isValid).toBe(false);
	});

	it.each([
		['bpmMin', BPM_MIN],
		['bpmMin', BPM_MAX],
		['bpmMax', BPM_MIN],
		['bpmMax', BPM_MAX]
	] as const)('accepts boundary value %i for %s', (field, value) => {
		const result = query(`${field}=${value}`);

		expect(result.filters[field]).toBe(value);
		expect(result.values[field]).toBe(String(value));
		expect(result.errors).toEqual({});
		expect(result.isValid).toBe(true);
	});

	it('accepts equal minimum and maximum BPM values', () => {
		const result = query('bpmMin=120&bpmMax=120');

		expect(result.filters).toMatchObject({ bpmMin: 120, bpmMax: 120 });
		expect(result.errors).toEqual({});
		expect(result.isValid).toBe(true);
	});

	it.each([
		['bpmMin', '19', 'Minimum'],
		['bpmMin', '301', 'Minimum'],
		['bpmMax', '19', 'Maximum'],
		['bpmMax', '301', 'Maximum'],
		['bpmMin', '120.5', 'Minimum'],
		['bpmMax', '1e2', 'Maximum'],
		['bpmMin', '+120', 'Minimum'],
		['bpmMax', '-120', 'Maximum'],
		['bpmMin', 'NaN', 'Minimum'],
		['bpmMax', 'Infinity', 'Maximum'],
		['bpmMin', '9007199254740992', 'Minimum']
	] as const)('rejects noncanonical or out-of-range %s=%s', (field, value, label) => {
		const result = query(`${field}=${encodeURIComponent(value)}`);

		expect(result.filters).not.toHaveProperty(field);
		expect(result.errors[field]).toBe(
			`${label} BPM must be an integer between ${BPM_MIN} and ${BPM_MAX}.`
		);
		expect(result.isValid).toBe(false);
	});

	it.each([
		['bpmMin', '020', 'Minimum'],
		['bpmMin', '00120', 'Minimum'],
		['bpmMax', '0300', 'Maximum'],
		['bpmMax', '000', 'Maximum']
	] as const)('rejects a leading-zero BPM encoding for %s=%s', (field, value, label) => {
		const result = query(`${field}=${value}`);

		expect(result.filters).not.toHaveProperty(field);
		expect(result.errors[field]).toBe(
			`${label} BPM must be an integer between ${BPM_MIN} and ${BPM_MAX}.`
		);
		expect(result.isValid).toBe(false);
	});

	it('bounds a very long invalid BPM display value', () => {
		const result = query(`bpmMin=${'9'.repeat(80)}`);

		expect(result.values.bpmMin).toHaveLength(32);
		expect(result.filters).not.toHaveProperty('bpmMin');
		expect(result.errors.bpmMin).toBeDefined();
		expect(result.isValid).toBe(false);
	});

	it('reports an inverted BPM range while retaining both parsed values', () => {
		const result = query('bpmMin=141&bpmMax=140');

		expect(result.filters).toMatchObject({ bpmMin: 141, bpmMax: 140 });
		expect(result.errors).toEqual({
			bpmRange: 'Minimum BPM cannot be greater than maximum BPM.'
		});
		expect(result.isValid).toBe(false);
	});

	it('does not add a range error when either BPM endpoint is invalid', () => {
		const result = query('bpmMin=invalid&bpmMax=100');

		expect(result.filters.bpmMax).toBe(100);
		expect(result.errors.bpmMin).toBeDefined();
		expect(result.errors).not.toHaveProperty('bpmRange');
	});

	it.each(MUSICAL_KEYS)('accepts supported musical key %s', (musicalKey) => {
		const result = query(`musicalKey=${encodeURIComponent(musicalKey)}`);

		expect(result.filters.musicalKey).toBe(musicalKey);
		expect(result.values.musicalKey).toBe(musicalKey);
		expect(result.errors).toEqual({});
	});

	it('rejects an unsupported musical key', () => {
		const result = query('musicalKey=H+major');

		expect(result.filters).not.toHaveProperty('musicalKey');
		expect(result.values.musicalKey).toBe('H major');
		expect(result.errors.musicalKey).toBe('The selected musical key is not valid.');
		expect(result.isValid).toBe(false);
	});

	it.each(MUSIC_GENRES)('accepts supported genre %s', (genre) => {
		const result = query(`genre=${encodeURIComponent(genre)}`);

		expect(result.filters.genre).toBe(genre);
		expect(result.values.genre).toBe(genre);
		expect(result.errors).toEqual({});
	});

	it('rejects an unsupported genre', () => {
		const result = query('genre=Country');

		expect(result.filters).not.toHaveProperty('genre');
		expect(result.values.genre).toBe('Country');
		expect(result.errors.genre).toBe('The selected genre is not valid.');
		expect(result.isValid).toBe(false);
	});

	it.each(TRACK_SORTS)('accepts supported sort %s', (sort) => {
		const result = query(`sort=${sort}`);

		expect(result.filters.sort).toBe(sort);
		expect(result.values.sort).toBe(sort);
		expect(result.errors).toEqual({});
		expect(result.isValid).toBe(true);
	});

	it.each(['unknown', 'NEWEST', 'title-desc'])(
		'falls back safely for invalid sort %j',
		(sort) => {
			const result = query(`sort=${encodeURIComponent(sort)}`);

			expect(result.filters.sort).toBe(DEFAULT_TRACK_SORT);
			expect(result.values.sort).toBe(DEFAULT_TRACK_SORT);
			expect(result.errors).toEqual({});
			expect(result.isValid).toBe(true);
		}
	);

	it('trims a supported sort value before parsing it', () => {
		const result = query('sort=+oldest+');

		expect(result.filters.sort).toBe('oldest');
		expect(result.values.sort).toBe('oldest');
		expect(result.isValid).toBe(true);
	});

	it('ignores unrelated parameters', () => {
		const result = query(
			'page=99&ownerId=forged&visibility=private&storedFilename=secret.mp3'
		);

		expect(result).toEqual(query());
	});

	it('uses only the first value for repeated parameters', () => {
		const result = query('q=first&q=second&bpmMin=100&bpmMin=200');

		expect(result.filters.q).toBe('first');
		expect(result.filters.bpmMin).toBe(100);
		expect(result.values.q).toBe('first');
		expect(result.values.bpmMin).toBe('100');
	});

	it('collects independent field errors without exposing unbounded values', () => {
		const result = query(
			`q=${'x'.repeat(TRACK_SEARCH_MAX_LENGTH + 1)}&bpmMin=019&bpmMax=301&musicalKey=invalid&genre=invalid`
		);

		expect(result.isValid).toBe(false);
		expect(result.errors).toEqual({
			q: `Search must be at most ${TRACK_SEARCH_MAX_LENGTH} characters.`,
			bpmMin: `Minimum BPM must be an integer between ${BPM_MIN} and ${BPM_MAX}.`,
			bpmMax: `Maximum BPM must be an integer between ${BPM_MIN} and ${BPM_MAX}.`,
			musicalKey: 'The selected musical key is not valid.',
			genre: 'The selected genre is not valid.'
		});
		expect(result.values.q).toHaveLength(TRACK_SEARCH_MAX_LENGTH);
	});
});

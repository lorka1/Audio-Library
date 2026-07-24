import { describe, expect, it } from 'vitest';
import { MAX_PUBLIC_TRACK_ID, parseTrackId } from './id';

describe('parseTrackId', () => {
	it.each([
		['1', 1],
		['42', 42],
		[String(MAX_PUBLIC_TRACK_ID), MAX_PUBLIC_TRACK_ID]
	])('accepts the positive integer ID %s', (value, expected) => {
		expect(parseTrackId(value)).toBe(expected);
	});

	it.each([
		'',
		' ',
		'0',
		'-1',
		'1.5',
		'text',
		'NaN',
		' 1 ',
		String(Number.MAX_SAFE_INTEGER + 1),
		String(MAX_PUBLIC_TRACK_ID + 1),
		'9'.repeat(100)
	])('rejects an invalid or unreasonable ID: %j', (value) => {
		expect(parseTrackId(value)).toBeNull();
	});
});

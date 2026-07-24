import { describe, expect, it } from 'vitest';
import { parseByteRange } from './range';

describe('parseByteRange', () => {
	it('returns a full response when the Range header is absent', () => {
		expect(parseByteRange(null, 2000)).toEqual({ kind: 'full' });
	});

	it.each([
		['bytes=0-999', 2000, { kind: 'partial', start: 0, end: 999, length: 1000 }],
		['bytes=1000-', 2000, { kind: 'partial', start: 1000, end: 1999, length: 1000 }],
		['bytes=-500', 2000, { kind: 'partial', start: 1500, end: 1999, length: 500 }],
		['bytes=1900-9999', 2000, { kind: 'partial', start: 1900, end: 1999, length: 100 }],
		['bytes=-9999', 2000, { kind: 'partial', start: 0, end: 1999, length: 2000 }],
		['BYTES=0-9', 2000, { kind: 'partial', start: 0, end: 9, length: 10 }]
	])('parses %s', (header, fileSize, expected) => {
		expect(parseByteRange(header, fileSize)).toEqual(expected);
	});

	it.each([
		['bytes=2000-', 2000],
		['bytes=2001-', 2000],
		['bytes=100-99', 2000],
		['items=0-9', 2000],
		['bytes=-', 2000],
		['bytes=0-1,4-5', 2000],
		['bytes=one-two', 2000],
		['bytes=1.5-2', 2000],
		['bytes=+1-2', 2000],
		['bytes=1e2-200', 2000],
		['bytes=-0', 2000],
		[`bytes=${Number.MAX_SAFE_INTEGER + 1}-`, 2000],
		['bytes=0-0', 0],
		['bytes=-1', 0]
	])('rejects %s for a %d-byte file', (header, fileSize) => {
		expect(parseByteRange(header, fileSize)).toEqual({ kind: 'unsatisfiable' });
	});

	it('allows a full response for a zero-byte file', () => {
		expect(parseByteRange(null, 0)).toEqual({ kind: 'full' });
	});
});

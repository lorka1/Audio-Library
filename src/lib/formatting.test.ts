import { describe, expect, it } from 'vitest';
import { formatDate, formatFileSize } from './formatting';

describe('public formatting helpers', () => {
	it('formats dates in deterministic English UTC', () => {
		expect(formatDate('2026-07-24T23:30:00.000-05:00')).toBe('July 25, 2026');
	});

	it.each([
		[0, '0 bytes'],
		[1, '1 byte'],
		[1024, '1 KB'],
		[1536, '1.5 KB'],
		[1024 * 1024, '1 MB']
	])('formats %d bytes as %s', (bytes, expected) => {
		expect(formatFileSize(bytes)).toBe(expected);
	});

	it('handles invalid sizes safely', () => {
		expect(formatFileSize(-1)).toBe('Not available');
		expect(formatFileSize(Number.NaN)).toBe('Not available');
	});
});

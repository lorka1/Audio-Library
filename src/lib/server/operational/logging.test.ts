import { describe, expect, it, vi } from 'vitest';
import { routeCategory, safeErrorFields, writeSafeLog } from './logging';

describe('safe structured logging', () => {
	it('never serializes raw error messages or private values', () => {
		const output = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const secret = 'private-secret@example.invalid';
		writeSafeLog({
			severity: 'error',
			category: 'mongodb',
			...safeErrorFields(new Error(secret))
		});
		const line = String(output.mock.calls[0][0]);
		expect(line).not.toContain(secret);
		expect(line).toContain('"category":"mongodb"');
		output.mockRestore();
	});

	it('uses stable route categories instead of concrete identifiers', () => {
		expect(routeCategory('/tracks/123')).toBe('public_tracks');
		expect(routeCategory('/api/tracks/123/stream')).toBe('media');
		expect(routeCategory('/my-tracks/123/edit')).toBe('owner_tracks');
	});
});

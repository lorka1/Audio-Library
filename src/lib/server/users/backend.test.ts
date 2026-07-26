import { describe, expect, it } from 'vitest';
import {
	parseDatabaseBackend,
	readDatabaseBackend,
	assertUnifiedAuthBackend
} from './backend';

describe('database backend selection', () => {
	it.each([undefined, '', '   '])(
		'defaults SQLite when DATABASE_BACKEND is absent or blank',
		(value) => {
			expect(parseDatabaseBackend(value)).toBe('sqlite');
			expect(readDatabaseBackend({ DATABASE_BACKEND: value })).toBe(
				'sqlite'
			);
		}
	);

	it.each(['sqlite', 'mongodb'] as const)(
		'accepts the supported %s backend',
		(backend) => {
			expect(parseDatabaseBackend(backend)).toBe(backend);
		}
	);

	it('rejects unsupported values without echoing environment data', () => {
		expect(() => parseDatabaseBackend('postgresql')).toThrowError(
			'DATABASE_BACKEND must be either sqlite or mongodb.'
		);
	});

	it('forbids mixed user and session backends', () => {
		expect(assertUnifiedAuthBackend('sqlite', 'sqlite')).toBe('sqlite');
		expect(assertUnifiedAuthBackend('mongodb', 'mongodb')).toBe('mongodb');
		expect(() =>
			assertUnifiedAuthBackend('mongodb', 'sqlite')
		).toThrowError('Mixed user and session backends are forbidden.');
	});
});

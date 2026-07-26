import { describe, expect, it } from 'vitest';
import {
	parseDatabaseBackend,
	readDatabaseBackend,
	requireM2ApplicationBackend,
	UnsafeM2BackendTransitionError
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

	it('prevents MongoDB user cutover while sessions remain in SQLite', () => {
		expect(
			requireM2ApplicationBackend({ DATABASE_BACKEND: 'sqlite' })
		).toBe('sqlite');
		expect(() =>
			requireM2ApplicationBackend({ DATABASE_BACKEND: 'mongodb' })
		).toThrowError(UnsafeM2BackendTransitionError);
	});
});

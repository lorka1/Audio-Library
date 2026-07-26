export const DATABASE_BACKENDS = ['sqlite', 'mongodb'] as const;

export type DatabaseBackend = (typeof DATABASE_BACKENDS)[number];

export interface DatabaseBackendEnvironment {
	DATABASE_BACKEND?: string;
}

export function parseDatabaseBackend(
	value: string | undefined
): DatabaseBackend {
	const backend = value?.trim() || 'sqlite';

	if (backend !== 'sqlite' && backend !== 'mongodb') {
		throw new Error(
			'DATABASE_BACKEND must be either sqlite or mongodb.'
		);
	}

	return backend;
}

export function readDatabaseBackend(
	environment: DatabaseBackendEnvironment = process.env
): DatabaseBackend {
	return parseDatabaseBackend(environment.DATABASE_BACKEND);
}

export function assertUnifiedAuthBackend(
	userBackend: DatabaseBackend,
	sessionBackend: DatabaseBackend
): DatabaseBackend {
	if (userBackend !== sessionBackend) {
		throw new Error('Mixed user and session backends are forbidden.');
	}
	return userBackend;
}

export const DATABASE_BACKENDS = ['sqlite', 'mongodb'] as const;

export type DatabaseBackend = (typeof DATABASE_BACKENDS)[number];

export interface DatabaseBackendEnvironment {
	DATABASE_BACKEND?: string;
}

export class UnsafeM2BackendTransitionError extends Error {
	constructor() {
		super(
			'DATABASE_BACKEND=mongodb cannot serve application users until sessions migrate in M3.'
		);
		this.name = 'UnsafeM2BackendTransitionError';
	}
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

export function requireM2ApplicationBackend(
	environment: DatabaseBackendEnvironment = process.env
): 'sqlite' {
	const backend = readDatabaseBackend(environment);

	if (backend === 'mongodb') {
		throw new UnsafeM2BackendTransitionError();
	}

	return backend;
}

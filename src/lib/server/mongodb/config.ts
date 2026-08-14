export const MONGODB_SERVER_SELECTION_TIMEOUT_MS = 8_000;
export const MONGODB_CONNECT_TIMEOUT_MS = 8_000;
export const MONGODB_SOCKET_TIMEOUT_MS = 15_000;

const DATABASE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;
const MONGODB_URI_PATTERN = /^mongodb(?:\+srv)?:\/\//i;
const PROTECTED_DATABASE_NAMES = new Set(['admin', 'config', 'local']);

export interface MongoEnvironment {
	MONGODB_URI?: string;
	MONGODB_DB_NAME?: string;
}

export interface MongoConfig {
	uri: string;
	databaseName: string;
	serverSelectionTimeoutMs: number;
	connectTimeoutMs: number;
	socketTimeoutMs: number;
}

function requireValue(
	environment: MongoEnvironment,
	name: keyof MongoEnvironment
): string {
	const value = environment[name]?.trim();

	if (!value) {
		throw new Error(`Missing required environment variable ${name}.`);
	}

	return value;
}

function validateDatabaseName(name: string, variableName: string): void {
	if (!DATABASE_NAME_PATTERN.test(name)) {
		throw new Error(
			`${variableName} must be 1-63 characters and contain only letters, numbers, underscores, or hyphens.`
		);
	}

	if (PROTECTED_DATABASE_NAMES.has(name.toLowerCase())) {
		throw new Error(`${variableName} must not select a protected MongoDB system database.`);
	}
}

function validateMongoUri(uri: string): void {
	if (!MONGODB_URI_PATTERN.test(uri)) {
		throw new Error(
			'MONGODB_URI must be a valid mongodb:// or mongodb+srv:// connection string.'
		);
	}

	try {
		const parsed = new URL(uri);

		if (!parsed.hostname) {
			throw new Error('missing hostname');
		}
	} catch {
		throw new Error(
			'MONGODB_URI must be a valid mongodb:// or mongodb+srv:// connection string.'
		);
	}
}

export function parseMongoConfig(
	environment: MongoEnvironment
): MongoConfig {
	const uri = requireValue(environment, 'MONGODB_URI');
	const databaseName = requireValue(environment, 'MONGODB_DB_NAME');

	validateMongoUri(uri);
	validateDatabaseName(databaseName, 'MONGODB_DB_NAME');

	return {
		uri,
		databaseName,
		serverSelectionTimeoutMs: MONGODB_SERVER_SELECTION_TIMEOUT_MS,
		connectTimeoutMs: MONGODB_CONNECT_TIMEOUT_MS,
		socketTimeoutMs: MONGODB_SOCKET_TIMEOUT_MS
	};
}

export function readMongoConfig(
	environment: MongoEnvironment = process.env
): MongoConfig {
	return parseMongoConfig(environment);
}

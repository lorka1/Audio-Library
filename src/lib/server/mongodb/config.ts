export const MONGODB_TEST_DATABASE_PREFIX = 'audio_library_test_';
export const MONGODB_SERVER_SELECTION_TIMEOUT_MS = 8_000;

const DATABASE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;
const MONGODB_URI_PATTERN = /^mongodb(?:\+srv)?:\/\//i;

export interface MongoEnvironment {
	MONGODB_URI?: string;
	MONGODB_DB_NAME?: string;
	MONGODB_TEST_DB_NAME?: string;
}

export interface MongoConfig {
	uri: string;
	databaseName: string;
	testDatabaseName: string;
	serverSelectionTimeoutMs: number;
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

export function assertMongoTestDatabaseName(
	testDatabaseName: string,
	databaseName: string
): void {
	if (testDatabaseName === databaseName) {
		throw new Error(
			'MONGODB_TEST_DB_NAME must differ from MONGODB_DB_NAME.'
		);
	}

	if (!testDatabaseName.startsWith(MONGODB_TEST_DATABASE_PREFIX)) {
		throw new Error(
			`MONGODB_TEST_DB_NAME must start with ${MONGODB_TEST_DATABASE_PREFIX}.`
		);
	}
}

export function parseMongoConfig(
	environment: MongoEnvironment
): MongoConfig {
	const uri = requireValue(environment, 'MONGODB_URI');
	const databaseName = requireValue(environment, 'MONGODB_DB_NAME');
	const testDatabaseName = requireValue(
		environment,
		'MONGODB_TEST_DB_NAME'
	);

	validateMongoUri(uri);
	validateDatabaseName(databaseName, 'MONGODB_DB_NAME');
	validateDatabaseName(testDatabaseName, 'MONGODB_TEST_DB_NAME');
	assertMongoTestDatabaseName(testDatabaseName, databaseName);

	return {
		uri,
		databaseName,
		testDatabaseName,
		serverSelectionTimeoutMs: MONGODB_SERVER_SELECTION_TIMEOUT_MS
	};
}

export function readMongoConfig(
	environment: MongoEnvironment = process.env
): MongoConfig {
	return parseMongoConfig(environment);
}

export function redactMongoUri(uri: string): string {
	const scheme = uri.match(MONGODB_URI_PATTERN)?.[0]?.toLowerCase();
	return scheme ? `${scheme}<redacted>` : '<redacted MongoDB URI>';
}

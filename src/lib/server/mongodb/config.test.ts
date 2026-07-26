import { describe, expect, it } from 'vitest';
import {
	assertMongoTestDatabaseName,
	MONGODB_TEST_DATABASE_PREFIX,
	parseMongoConfig,
	redactMongoUri,
	type MongoEnvironment
} from './config';

const validEnvironment: MongoEnvironment = {
	MONGODB_URI: 'mongodb://fixture-host.example.invalid:27017',
	MONGODB_DB_NAME: 'audio_library_dev',
	MONGODB_TEST_DB_NAME: 'audio_library_test_unit'
};

describe('MongoDB environment validation', () => {
	it('accepts isolated project development and test names', () => {
		expect(parseMongoConfig(validEnvironment)).toMatchObject({
			uri: validEnvironment.MONGODB_URI,
			databaseName: 'audio_library_dev',
			testDatabaseName: 'audio_library_test_unit'
		});
	});

	it.each([undefined, '', '   '])('rejects a missing or blank URI: %s', (uri) => {
		expect(() =>
			parseMongoConfig({ ...validEnvironment, MONGODB_URI: uri })
		).toThrowError('Missing required environment variable MONGODB_URI.');
	});

	it('rejects malformed URIs without returning connection details', () => {
		const unsafeValue = 'https://user:secret@private-host.example.test';

		expect(() =>
			parseMongoConfig({
				...validEnvironment,
				MONGODB_URI: unsafeValue
			})
		).toThrowError(
			'MONGODB_URI must be a valid mongodb:// or mongodb+srv:// connection string.'
		);

		try {
			parseMongoConfig({
				...validEnvironment,
				MONGODB_URI: unsafeValue
			});
		} catch (error) {
			expect(String(error)).not.toContain('user');
			expect(String(error)).not.toContain('secret');
			expect(String(error)).not.toContain('private-host');
		}
	});

	it.each([
		['MONGODB_DB_NAME', 'unsafe name'],
		['MONGODB_DB_NAME', 'unsafe/name'],
		['MONGODB_TEST_DB_NAME', 'audio.library.test'],
		['MONGODB_TEST_DB_NAME', 'audio_library_test_$unsafe']
	] as const)('rejects an unsafe %s value', (name, value) => {
		expect(() =>
			parseMongoConfig({ ...validEnvironment, [name]: value })
		).toThrowError(`${name} must be 1-63 characters`);
	});

	it('rejects equal development and test database names', () => {
		expect(() =>
			parseMongoConfig({
				...validEnvironment,
				MONGODB_TEST_DB_NAME: validEnvironment.MONGODB_DB_NAME
			})
		).toThrowError(
			'MONGODB_TEST_DB_NAME must differ from MONGODB_DB_NAME.'
		);
	});

	it('requires the project-specific test database prefix', () => {
		expect(() =>
			assertMongoTestDatabaseName('generic_test_database', 'audio_library_dev')
		).toThrowError(
			`MONGODB_TEST_DB_NAME must start with ${MONGODB_TEST_DATABASE_PREFIX}.`
		);
	});
});

describe('MongoDB URI redaction', () => {
	it('removes credentials and connection details', () => {
		const uri =
			'mongodb+srv://fixture-user:fixture-secret@cluster.example.invalid/database';
		const redacted = redactMongoUri(uri);

		expect(redacted).toBe('mongodb+srv://<redacted>');
		expect(redacted).not.toContain('fixture-user');
		expect(redacted).not.toContain('fixture-secret');
		expect(redacted).not.toContain('cluster');
	});

	it('redacts malformed values without echoing them', () => {
		expect(redactMongoUri('not-a-uri-with-secret')).toBe(
			'<redacted MongoDB URI>'
		);
	});
});

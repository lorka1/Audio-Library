import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseOperationalConfig } from '../../src/lib/server/operational/config.ts';
import {
	buildSyntheticEnvironment,
	createSyntheticApplicationEnvironment,
	SYNTHETIC_APPLICATION_ENVIRONMENT,
	SYNTHETIC_UNIT_MONGODB_URI,
	SYNTHETIC_UPLOAD_LIMIT_ENVIRONMENT
} from './synthetic-app-environment.mjs';

function remainsInside(parent, child) {
	const relation = relative(resolve(parent), resolve(child));
	return relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation);
}

describe('synthetic application environment', () => {
	it('builds a complete parsing baseline without private environment values', () => {
		const ownedRoot = resolve(tmpdir(), 'audio-library-vitest-test-config');
		const environment = buildSyntheticEnvironment(
			{ KEEP_FOR_CHILD: 'preserved' },
			{ AUDIO_STORAGE_PATH: join(ownedRoot, 'audio') }
		);
		const config = parseOperationalConfig(
			environment,
			resolve(tmpdir(), 'audio-library-fixture-project')
		);

		expect(config.mongo.uri).toBe(SYNTHETIC_UNIT_MONGODB_URI);
		expect(config.mongo.databaseName).toMatch(/^audio_library_unit_\d+$/);
		expect(config.mongo.testDatabaseName).toMatch(/^audio_library_test_unit_\d+$/);
		expect(config.mongo.databaseName).not.toBe(config.mongo.testDatabaseName);
		expect(config.maxAudioFileSizeMb).toBe(50);
		expect(config.coverImageMaxSizeMb).toBe(5);
		expect(config.bodySizeLimitBytes).toBe(60 * 1024 * 1024);
		expect(environment.KEEP_FOR_CHILD).toBe('preserved');
		expect(remainsInside(ownedRoot, config.audioStoragePath)).toBe(true);
	});

	it('uses a credential-free loopback URI and clearly synthetic database names', () => {
		const parsed = new URL(SYNTHETIC_UNIT_MONGODB_URI);
		expect(parsed.hostname).toBe('127.0.0.1');
		expect(parsed.port).toBe('1');
		expect(parsed.username).toBe('');
		expect(parsed.password).toBe('');
		expect(parsed.searchParams.get('directConnection')).toBe('true');
		expect(parsed.searchParams.get('serverSelectionTimeoutMS')).toBe('100');
		expect(SYNTHETIC_APPLICATION_ENVIRONMENT.MONGODB_DB_NAME).not.toMatch(
			/^audio_library(?:_dev)?$/
		);
		expect(SYNTHETIC_APPLICATION_ENVIRONMENT.MONGODB_TEST_DB_NAME).toMatch(
			/^audio_library_test_/
		);
	});

	it('applies defaults before caller overrides without mutating either input', () => {
		const secret = 'synthetic-environment-secret';
		const parent = {
			KEEP_FOR_CHILD: 'preserved',
			MAX_AUDIO_FILE_SIZE_MB: '1',
			COVER_IMAGE_MAX_SIZE_MB: '2',
			BODY_SIZE_LIMIT: '3M',
			MONGODB_URI: `mongodb://fixture:${secret}@example.invalid:27017`,
			MONGODB_DB_NAME: 'real_development_name'
		};
		const overrides = {
			CI: '1',
			MONGODB_URI: 'mongodb://127.0.0.1:27099/?directConnection=true',
			MONGODB_DB_NAME: 'audio_library_owned_integration',
			MONGODB_TEST_DB_NAME: 'audio_library_test_owned_integration'
		};
		const parentBefore = { ...parent };
		const overridesBefore = { ...overrides };

		const environment = buildSyntheticEnvironment(parent, overrides);

		expect(environment).toMatchObject({
			KEEP_FOR_CHILD: 'preserved',
			CI: '1',
			MONGODB_URI: overrides.MONGODB_URI,
			MONGODB_DB_NAME: overrides.MONGODB_DB_NAME,
			MONGODB_TEST_DB_NAME: overrides.MONGODB_TEST_DB_NAME,
			MAX_AUDIO_FILE_SIZE_MB: '50',
			COVER_IMAGE_MAX_SIZE_MB: '5',
			BODY_SIZE_LIMIT: '60M'
		});
		expect(createSyntheticApplicationEnvironment(overrides, parent)).toEqual(environment);
		expect(parent).toEqual(parentBefore);
		expect(overrides).toEqual(overridesBefore);
		expect(JSON.stringify(SYNTHETIC_UPLOAD_LIMIT_ENVIRONMENT)).not.toContain(secret);
		expect(JSON.stringify(SYNTHETIC_UPLOAD_LIMIT_ENVIRONMENT)).not.toContain('mongodb://');
	});

	it('keeps negative configuration checks effective and diagnostics private', () => {
		const missingUri = buildSyntheticEnvironment({});
		delete missingUri.MONGODB_URI;
		expect(() => parseOperationalConfig(missingUri)).toThrow(
			'Missing required environment variable MONGODB_URI.'
		);

		const secret = 'synthetic-diagnostic-secret';
		const invalidLimit = buildSyntheticEnvironment({}, {
			MONGODB_URI: `mongodb://fixture:${secret}@fixture.example.invalid:27017`,
			BODY_SIZE_LIMIT: '55M'
		});
		let message = '';
		try {
			parseOperationalConfig(invalidLimit);
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain('BODY_SIZE_LIMIT');
		expect(message).not.toContain(secret);
		expect(message).not.toContain('mongodb://');
	});
});

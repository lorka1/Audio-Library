import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	assertPrivateAudioStoragePath,
	assertProductionRuntimeConfig,
	parseOperationalConfig,
	preparePrivateAudioStorage,
	type OperationalEnvironment
} from './config';

const roots: string[] = [];
const valid: OperationalEnvironment = {
	MONGODB_URI: 'mongodb://fixture.example.invalid:27017',
	MONGODB_DB_NAME: 'audio_library_dev',
	MONGODB_TEST_DB_NAME: 'audio_library_test_unit',
	AUDIO_STORAGE_PATH: 'private-audio',
	MAX_AUDIO_FILE_SIZE_MB: '50',
	BODY_SIZE_LIMIT: '55M',
	SESSION_COOKIE_NAME: 'audio_library_session',
	SESSION_DURATION_DAYS: '7'
};

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('operational startup configuration', () => {
	it.each([
		['MONGODB_URI', undefined, 'Missing required environment variable MONGODB_URI.'],
		['MONGODB_URI', 'not-a-uri', 'MONGODB_URI must be a valid'],
		['MONGODB_DB_NAME', undefined, 'Missing required environment variable MONGODB_DB_NAME.'],
		['MONGODB_DB_NAME', 'admin', 'protected MongoDB system database'],
		['SESSION_COOKIE_NAME', undefined, 'Missing required environment variable SESSION_COOKIE_NAME.'],
		['SESSION_DURATION_DAYS', '0', 'must be an integer between 1 and 30']
	] as const)('rejects invalid %s', (name, value, message) => {
		expect(() => parseOperationalConfig({ ...valid, [name]: value })).toThrow(message);
	});

	it('rejects public audio storage and incompatible body limits', () => {
		expect(() =>
			parseOperationalConfig({ ...valid, AUDIO_STORAGE_PATH: 'static/audio' })
		).toThrow('must not be inside a publicly served directory');
		expect(() =>
			parseOperationalConfig({ ...valid, BODY_SIZE_LIMIT: '50M' })
		).toThrow('must be greater');
	});

	it('requires HTTPS origin for safe production cookies', () => {
		expect(() =>
			assertProductionRuntimeConfig({
				...valid,
				MONGODB_URI: 'mongodb://fixture:secret@fixture.example.invalid:27017',
				NODE_ENV: 'production',
				ORIGIN: 'http://example.test'
			})
		).toThrow('must use HTTPS');
		expect(() =>
			assertProductionRuntimeConfig({
				...valid,
				MONGODB_URI: 'mongodb://fixture:secret@fixture.example.invalid:27017',
				NODE_ENV: 'production',
				ORIGIN: 'https://example.test'
			})
		).not.toThrow();
	});

	it('creates and verifies a dedicated writable private directory', async () => {
		const root = await mkdtemp(join(tmpdir(), 'audio-library-config-'));
		roots.push(root);
		const storage = resolve(root, 'audio');
		await expect(preparePrivateAudioStorage(storage)).resolves.toBeUndefined();
	});

	it('rejects a file where an audio directory is required', async () => {
		const root = await mkdtemp(join(tmpdir(), 'audio-library-config-'));
		roots.push(root);
		const path = resolve(root, 'not-a-directory');
		await writeFile(path, 'fixture');
		await expect(preparePrivateAudioStorage(path)).rejects.toThrow();
	});

	it('rejects filesystem roots as storage', () => {
		expect(() => assertPrivateAudioStoragePath(resolve('/'))).toThrow();
	});
});

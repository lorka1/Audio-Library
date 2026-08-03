import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	assertPrivateAudioStoragePath,
	assertProductionRuntimeConfig,
	checkPrivateAudioStorage,
	checkPrivateCoverImageStorage,
	MULTIPART_UPLOAD_OVERHEAD_BYTES,
	parseOperationalConfig,
	preparePrivateAudioStorage,
	preparePrivateCoverImageStorage,
	type OperationalEnvironment
} from './config';

const roots: string[] = [];
const valid: OperationalEnvironment = {
	MONGODB_URI: 'mongodb://fixture.example.invalid:27017',
	MONGODB_DB_NAME: 'audio_library_dev',
	MONGODB_TEST_DB_NAME: 'audio_library_test_unit',
	AUDIO_STORAGE_PATH: 'private-audio',
	MAX_AUDIO_FILE_SIZE_MB: '50',
	BODY_SIZE_LIMIT: '60M',
	SESSION_COOKIE_NAME: 'audio_library_session',
	SESSION_DURATION_DAYS: '7'
};

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('operational startup configuration', () => {
	it('derives private cover storage and applies a backward-compatible 5 MB default', () => {
		const config = parseOperationalConfig(valid, resolve('fixture-project'));
		expect(config.coverImageMaxSizeMb).toBe(5);
		expect(config.coverImageMaxSizeBytes).toBe(5 * 1024 * 1024);
		expect(config.coverImageStoragePath).toBe(
			resolve('fixture-project', 'private-audio', 'covers')
		);

		const configured = parseOperationalConfig({
			...valid,
			COVER_IMAGE_MAX_SIZE_MB: '2.5'
		});
		expect(configured.coverImageMaxSizeMb).toBe(2.5);
		expect(configured.coverImageMaxSizeBytes).toBe(2.5 * 1024 * 1024);
	});

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

	it('rejects public audio storage', () => {
		expect(() =>
			parseOperationalConfig({ ...valid, AUDIO_STORAGE_PATH: 'static/audio' })
		).toThrow('must not be inside a publicly served directory');
	});

	it('requires room for maximum audio, maximum cover, and multipart overhead', () => {
		expect(MULTIPART_UPLOAD_OVERHEAD_BYTES).toBe(1024 * 1024);
		for (const bodySizeLimit of ['51M', '55M']) {
			expect(() =>
				parseOperationalConfig({ ...valid, BODY_SIZE_LIMIT: bodySizeLimit })
			).toThrow(
				'maximum audio file, maximum cover image, and 1 MB of multipart overhead'
			);
		}

		expect(() =>
			parseOperationalConfig({ ...valid, BODY_SIZE_LIMIT: '56M' })
		).not.toThrow();
	});

	it.each([
		['MAX_AUDIO_FILE_SIZE_MB', '0'],
		['MAX_AUDIO_FILE_SIZE_MB', '-1'],
		['MAX_AUDIO_FILE_SIZE_MB', '0.0000001'],
		['COVER_IMAGE_MAX_SIZE_MB', '0'],
		['COVER_IMAGE_MAX_SIZE_MB', '-1'],
		['COVER_IMAGE_MAX_SIZE_MB', '0.0000001'],
		['COVER_IMAGE_MAX_SIZE_MB', 'invalid'],
		['BODY_SIZE_LIMIT', '0'],
		['BODY_SIZE_LIMIT', '-1'],
		['BODY_SIZE_LIMIT', 'invalid']
	] as const)('rejects invalid non-positive upload configuration %s=%s', (name, value) => {
		expect(() => parseOperationalConfig({ ...valid, [name]: value })).toThrow();
	});

	it('keeps the common request limit valid for uploads that omit a cover', () => {
		const config = parseOperationalConfig({
			...valid,
			COVER_IMAGE_MAX_SIZE_MB: undefined,
			BODY_SIZE_LIMIT: '60M'
		});
		expect(config.bodySizeLimitBytes).toBe(60 * 1024 * 1024);
		expect(config.coverImageMaxSizeMb).toBe(5);
	});

	it('reports an incompatible body limit without exposing configuration secrets', () => {
		const secret = 'body-limit-secret';
		let message = '';
		try {
			parseOperationalConfig({
				...valid,
				MONGODB_URI: `mongodb://fixture:${secret}@fixture.example.invalid:27017`,
				BODY_SIZE_LIMIT: '51M'
			});
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain('BODY_SIZE_LIMIT');
		expect(message).not.toContain(secret);
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
		const covers = resolve(storage, 'covers');
		await expect(preparePrivateCoverImageStorage(covers)).resolves.toBeUndefined();
		await expect(checkPrivateCoverImageStorage(covers)).resolves.toBeUndefined();
	});

	it('rejects a file where an audio directory is required', async () => {
		const root = await mkdtemp(join(tmpdir(), 'audio-library-config-'));
		roots.push(root);
		const path = resolve(root, 'not-a-directory');
		await writeFile(path, 'fixture');
		await expect(preparePrivateAudioStorage(path)).rejects.toThrow();
		await expect(checkPrivateAudioStorage(path)).rejects.toThrow(
			'Private audio storage is unavailable.'
		);
	});

	it('reports inaccessible readiness storage without creating it', async () => {
		const root = await mkdtemp(join(tmpdir(), 'audio-library-config-'));
		roots.push(root);
		const missing = resolve(root, 'missing');
		await expect(checkPrivateAudioStorage(missing)).rejects.toThrow();
	});

	it('rejects filesystem roots as storage', () => {
		expect(() => assertPrivateAudioStoragePath(resolve('/'))).toThrow();
	});
});

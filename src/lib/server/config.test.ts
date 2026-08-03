import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalBodySizeLimit = process.env.BODY_SIZE_LIMIT;
const validEnvironment = {
	MONGODB_URI: 'mongodb://fixture.example.invalid:27017',
	MONGODB_DB_NAME: 'audio_library_dev',
	MONGODB_TEST_DB_NAME: 'audio_library_test_runtime_config',
	AUDIO_STORAGE_PATH: 'private-audio',
	MAX_AUDIO_FILE_SIZE_MB: '50',
	COVER_IMAGE_MAX_SIZE_MB: '5',
	BODY_SIZE_LIMIT: '60M',
	SESSION_COOKIE_NAME: 'audio_library_session',
	SESSION_DURATION_DAYS: '7'
};

afterEach(() => {
	if (originalBodySizeLimit === undefined) delete process.env.BODY_SIZE_LIMIT;
	else process.env.BODY_SIZE_LIMIT = originalBodySizeLimit;
	vi.doUnmock('./config');
	vi.resetModules();
});

function mockInvalidRuntimeConfig(): void {
	vi.doMock('./config', () => ({
		getServerConfig() {
			throw new Error('BODY_SIZE_LIMIT synthetic validation failure.');
		}
	}));
	vi.resetModules();
}

describe('lazy server runtime configuration', () => {
	it('does not parse an invalid runtime limit merely by importing the module', async () => {
		process.env.BODY_SIZE_LIMIT = '55M';
		vi.resetModules();
		const module = await import('./config');
		expect(module.getServerConfig).toBeTypeOf('function');
	});

	it('rejects 55 MiB and accepts 60 MiB when the runtime accessor is called', async () => {
		const { getServerConfig } = await import('./config');
		const projectRoot = resolve('fixture-runtime-config-project');
		expect(() =>
			getServerConfig({ ...validEnvironment, BODY_SIZE_LIMIT: '55M' }, projectRoot)
		).toThrow('BODY_SIZE_LIMIT');
		expect(
			getServerConfig(validEnvironment, projectRoot).bodySizeLimitBytes
		).toBe(60 * 1024 * 1024);
	});

	it('requires validated runtime configuration during application startup', async () => {
		mockInvalidRuntimeConfig();
		const {
			initializeApplication,
			resetApplicationStartupForTests
		} = await import('./operational/startup');
		resetApplicationStartupForTests();
		try {
			await expect(initializeApplication()).rejects.toThrow('BODY_SIZE_LIMIT');
		} finally {
			resetApplicationStartupForTests();
		}
	});

	it('requires validated runtime configuration during readiness checks', async () => {
		mockInvalidRuntimeConfig();
		const { checkApplicationReadiness } = await import('./operational/readiness');
		await expect(checkApplicationReadiness()).rejects.toThrow('BODY_SIZE_LIMIT');
	});
});

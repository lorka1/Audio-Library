import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const SYNTHETIC_UPLOAD_LIMIT_ENVIRONMENT = Object.freeze({
	MAX_AUDIO_FILE_SIZE_MB: '50',
	COVER_IMAGE_MAX_SIZE_MB: '5',
	BODY_SIZE_LIMIT: '60M'
});

const syntheticProcessToken = String(process.pid).replace(/[^0-9]/g, '') || '0';

export const SYNTHETIC_UNIT_MONGODB_URI =
	'mongodb://127.0.0.1:1/?directConnection=true&serverSelectionTimeoutMS=100&connectTimeoutMS=100';

export const SYNTHETIC_APPLICATION_ENVIRONMENT = Object.freeze({
	MONGODB_URI: SYNTHETIC_UNIT_MONGODB_URI,
	MONGODB_DB_NAME: `audio_library_unit_${syntheticProcessToken}`,
	MONGODB_TEST_DB_NAME: `audio_library_test_unit_${syntheticProcessToken}`,
	AUDIO_STORAGE_PATH: join(
		tmpdir(),
		`audio-library-unit-config-${syntheticProcessToken}`,
		'audio'
	),
	SESSION_COOKIE_NAME: 'audio_library_unit_test',
	SESSION_DURATION_DAYS: '7',
	...SYNTHETIC_UPLOAD_LIMIT_ENVIRONMENT
});

export function buildSyntheticEnvironment(
	baseEnvironment = process.env,
	overrides = {}
) {
	return {
		...baseEnvironment,
		...SYNTHETIC_APPLICATION_ENVIRONMENT,
		...overrides
	};
}

export function createSyntheticApplicationEnvironment(
	overrides = {},
	parentEnvironment = process.env
) {
	return buildSyntheticEnvironment(parentEnvironment, overrides);
}

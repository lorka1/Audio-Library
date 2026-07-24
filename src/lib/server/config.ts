import { env } from '$env/dynamic/private';
import { isAbsolute, resolve } from 'node:path';

function requiredPath(name: 'DATABASE_URL' | 'AUDIO_STORAGE_PATH'): string {
	const configuredPath = env[name];

	if (!configuredPath) {
		throw new Error(`Missing required environment variable ${name}.`);
	}

	return isAbsolute(configuredPath) ? configuredPath : resolve(process.cwd(), configuredPath);
}

export const serverConfig = {
	databasePath: requiredPath('DATABASE_URL'),
	audioStoragePath: requiredPath('AUDIO_STORAGE_PATH')
} as const;

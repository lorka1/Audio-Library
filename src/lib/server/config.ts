import { env } from '$env/dynamic/private';
import { isAbsolute, resolve } from 'node:path';
import { parseAudioFileSizeLimit } from './config-values';

const DEFAULT_SESSION_COOKIE_NAME = 'audio_library_session';
const DEFAULT_SESSION_DURATION_DAYS = 7;
const DEFAULT_AUDIO_STORAGE_PATH = 'storage/audio';

function resolvePath(configuredPath: string): string {
	return isAbsolute(configuredPath) ? configuredPath : resolve(process.cwd(), configuredPath);
}

function readAudioStoragePath(): string {
	return resolvePath(env.AUDIO_STORAGE_PATH?.trim() || DEFAULT_AUDIO_STORAGE_PATH);
}

function readSessionCookieName(): string {
	const cookieName = env.SESSION_COOKIE_NAME?.trim() || DEFAULT_SESSION_COOKIE_NAME;

	if (!/^[A-Za-z0-9_-]+$/.test(cookieName)) {
		throw new Error('SESSION_COOKIE_NAME may only contain letters, numbers, underscores, and hyphens.');
	}

	return cookieName;
}

function readSessionDurationDays(): number {
	const configuredValue = env.SESSION_DURATION_DAYS?.trim();
	const durationDays = configuredValue
		? Number(configuredValue)
		: DEFAULT_SESSION_DURATION_DAYS;

	if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 30) {
		throw new Error('SESSION_DURATION_DAYS must be an integer between 1 and 30.');
	}

	return durationDays;
}

const sessionDurationDays = readSessionDurationDays();
const audioFileSizeLimit = parseAudioFileSizeLimit(env.MAX_AUDIO_FILE_SIZE_MB);

export const serverConfig = {
	audioStoragePath: readAudioStoragePath(),
	maxAudioFileSizeMb: audioFileSizeLimit.megabytes,
	maxAudioFileSizeBytes: audioFileSizeLimit.bytes,
	sessionCookieName: readSessionCookieName(),
	sessionDurationDays,
	sessionDurationMs: sessionDurationDays * 24 * 60 * 60 * 1000
} as const;

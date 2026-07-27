import { access, lstat, mkdir, open, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { parseMongoConfig, type MongoConfig, type MongoEnvironment } from '../mongodb/config.ts';

const COOKIE_PATTERN = /^[A-Za-z0-9_-]+$/;
const BODY_LIMIT_PATTERN = /^(\d+(?:\.\d+)?)\s*([KMG])?B?$/i;
const MEBIBYTE = 1024 * 1024;

export interface OperationalEnvironment extends MongoEnvironment {
	AUDIO_STORAGE_PATH?: string;
	MAX_AUDIO_FILE_SIZE_MB?: string;
	BODY_SIZE_LIMIT?: string;
	SESSION_COOKIE_NAME?: string;
	SESSION_DURATION_DAYS?: string;
	NODE_ENV?: string;
	ORIGIN?: string;
}

export interface OperationalConfig {
	mongo: MongoConfig;
	audioStoragePath: string;
	maxAudioFileSizeMb: number;
	maxAudioFileSizeBytes: number;
	bodySizeLimitBytes: number;
	sessionCookieName: string;
	sessionDurationDays: number;
	sessionDurationMs: number;
	production: boolean;
}

function required(environment: OperationalEnvironment, name: keyof OperationalEnvironment): string {
	const value = environment[name]?.trim();
	if (!value) throw new Error(`Missing required environment variable ${name}.`);
	return value;
}

function parsePositiveNumber(value: string, name: string): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive number.`);
	}
	return parsed;
}

export function parseBodySizeLimit(value: string): number {
	const match = BODY_LIMIT_PATTERN.exec(value.trim());
	if (!match) throw new Error('BODY_SIZE_LIMIT must be a positive byte value with an optional K, M, or G suffix.');
	const amount = parsePositiveNumber(match[1], 'BODY_SIZE_LIMIT');
	const multiplier = { K: 1024, M: MEBIBYTE, G: 1024 * MEBIBYTE }[
		(match[2] ?? '').toUpperCase()
	] ?? 1;
	const bytes = Math.floor(amount * multiplier);
	if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error('BODY_SIZE_LIMIT is outside the supported range.');
	return bytes;
}

function isContained(parent: string, child: string): boolean {
	const relation = relative(parent, child);
	return relation === '' || (
		relation !== '..' &&
		!relation.startsWith(`..${sep}`) &&
		!isAbsolute(relation)
	);
}

export function assertPrivateAudioStoragePath(path: string, projectRoot = process.cwd()): void {
	const resolved = resolve(path);
	const filesystemRoot = parse(resolved).root;
	if (resolved === filesystemRoot || resolved === resolve(projectRoot)) {
		throw new Error('AUDIO_STORAGE_PATH must select a dedicated private directory.');
	}
	for (const publicRoot of ['static', 'public', 'build'].map((name) => resolve(projectRoot, name))) {
		if (isContained(publicRoot, resolved)) {
			throw new Error('AUDIO_STORAGE_PATH must not be inside a publicly served directory.');
		}
	}
}

export function parseOperationalConfig(
	environment: OperationalEnvironment,
	projectRoot = process.cwd()
): OperationalConfig {
	const mongo = parseMongoConfig(environment);
	const configuredStorage = required(environment, 'AUDIO_STORAGE_PATH');
	const audioStoragePath = isAbsolute(configuredStorage)
		? resolve(configuredStorage)
		: resolve(projectRoot, configuredStorage);
	assertPrivateAudioStoragePath(audioStoragePath, projectRoot);

	const maxAudioFileSizeMb = parsePositiveNumber(
		required(environment, 'MAX_AUDIO_FILE_SIZE_MB'),
		'MAX_AUDIO_FILE_SIZE_MB'
	);
	const maxAudioFileSizeBytes = Math.floor(maxAudioFileSizeMb * MEBIBYTE);
	if (!Number.isSafeInteger(maxAudioFileSizeBytes)) {
		throw new Error('MAX_AUDIO_FILE_SIZE_MB is outside the supported range.');
	}
	const bodySizeLimitBytes = parseBodySizeLimit(required(environment, 'BODY_SIZE_LIMIT'));
	if (bodySizeLimitBytes <= maxAudioFileSizeBytes) {
		throw new Error('BODY_SIZE_LIMIT must be greater than the maximum audio file size.');
	}

	const sessionCookieName = required(environment, 'SESSION_COOKIE_NAME');
	if (!COOKIE_PATTERN.test(sessionCookieName)) {
		throw new Error('SESSION_COOKIE_NAME may only contain letters, numbers, underscores, and hyphens.');
	}
	const sessionDurationDays = Number(required(environment, 'SESSION_DURATION_DAYS'));
	if (!Number.isInteger(sessionDurationDays) || sessionDurationDays < 1 || sessionDurationDays > 30) {
		throw new Error('SESSION_DURATION_DAYS must be an integer between 1 and 30.');
	}
	const production = environment.NODE_ENV === 'production';
	return {
		mongo,
		audioStoragePath,
		maxAudioFileSizeMb,
		maxAudioFileSizeBytes,
		bodySizeLimitBytes,
		sessionCookieName,
		sessionDurationDays,
		sessionDurationMs: sessionDurationDays * 24 * 60 * 60 * 1000,
		production
	};
}

export function assertProductionRuntimeConfig(environment: OperationalEnvironment): void {
	if (environment.NODE_ENV !== 'production') return;
	const origin = required(environment, 'ORIGIN');
	if (!origin.startsWith('https://')) {
		throw new Error('ORIGIN must use HTTPS in production so secure cookies remain safe.');
	}
	required(environment, 'MONGODB_URI');
}

export async function preparePrivateAudioStorage(path: string): Promise<void> {
	await mkdir(path, { recursive: true });
	const info = await lstat(path);
	if (!info.isDirectory() || info.isSymbolicLink()) {
		throw new Error('AUDIO_STORAGE_PATH must resolve to a private directory.');
	}
	await access(path, constants.R_OK | constants.W_OK);
	const probe = resolve(path, `.startup-${process.pid}-${Date.now()}.tmp`);
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		handle = await open(probe, 'wx', 0o600);
	} finally {
		await handle?.close();
		await unlink(probe).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== 'ENOENT') throw error;
		});
	}
}

export async function checkPrivateAudioStorage(path: string): Promise<void> {
	const info = await lstat(path);
	if (!info.isDirectory() || info.isSymbolicLink()) {
		throw new Error('Private audio storage is unavailable.');
	}
	await access(path, constants.R_OK);
}

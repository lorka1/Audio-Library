import { createHash, randomBytes } from 'node:crypto';

const SESSION_TOKEN_BYTES = 32;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateSessionToken(): string {
	return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

export function hashSessionToken(token: string): string {
	return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isSessionToken(value: string): boolean {
	return SESSION_TOKEN_PATTERN.test(value);
}

import { dev } from '$app/environment';
import type { Cookies } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { getServerConfig } from '$lib/server/config';
import { getAuthPersistence } from './persistence';
import {
	generateSessionToken,
	hashSessionToken,
	isSessionToken
} from './session-token';
import type { AuthSession, AuthState, PreparedSession } from './types';

export { generateSessionToken, hashSessionToken } from './session-token';

const cookieBaseOptions = {
	httpOnly: true,
	sameSite: 'lax' as const,
	path: '/',
	secure: !dev
};

export function prepareSession(userId: string, now = new Date()): PreparedSession {
	const token = generateSessionToken();
	const expiresAt = new Date(now.getTime() + getServerConfig().sessionDurationMs);

	return {
		token,
		record: {
			id: randomUUID(),
			userId,
			tokenHash: hashSessionToken(token),
			expiresAt
		}
	};
}

export async function createSession(userId: string): Promise<{
	token: string;
	session: AuthSession;
}> {
	const prepared = prepareSession(userId);
	const persistence = await getAuthPersistence();
	const session = await persistence.sessions.createSession(prepared.record);
	return { token: prepared.token, session };
}

export async function validateSessionToken(token: string): Promise<AuthState | null> {
	if (!isSessionToken(token)) {
		return null;
	}

	const persistence = await getAuthPersistence();
	return persistence.sessions.findValidSessionWithUser(
		hashSessionToken(token),
		new Date()
	);
}

export async function invalidateSession(token: string): Promise<void> {
	if (!isSessionToken(token)) {
		return;
	}

	const persistence = await getAuthPersistence();
	await persistence.sessions.deleteSessionByTokenHash(
		hashSessionToken(token)
	);
}

export async function deleteExpiredSessions(now = new Date()): Promise<void> {
	const persistence = await getAuthPersistence();
	await persistence.sessions.deleteExpiredSessions(now);
}

export function setSessionCookie(cookies: Cookies, token: string, expiresAt: Date): void {
	const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));

	cookies.set(getServerConfig().sessionCookieName, token, {
		...cookieBaseOptions,
		expires: expiresAt,
		maxAge
	});
}

export function deleteSessionCookie(cookies: Cookies): void {
	cookies.delete(getServerConfig().sessionCookieName, cookieBaseOptions);
}

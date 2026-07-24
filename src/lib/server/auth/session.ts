import { dev } from '$app/environment';
import type { Cookies } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { serverConfig } from '$lib/server/config';
import {
	createSessionRecord,
	deleteExpiredSessionRecords,
	deleteSessionById,
	deleteSessionByTokenHash,
	findSessionWithUserByTokenHash
} from './repository';
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
	const expiresAt = new Date(now.getTime() + serverConfig.sessionDurationMs);

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
	const session = await createSessionRecord(prepared.record);
	return { token: prepared.token, session };
}

export async function validateSessionToken(token: string): Promise<AuthState | null> {
	if (!isSessionToken(token)) {
		return null;
	}

	const state = await findSessionWithUserByTokenHash(hashSessionToken(token));

	if (!state) {
		return null;
	}

	if (state.session.expiresAt.getTime() <= Date.now()) {
		await deleteSessionById(state.session.id);
		return null;
	}

	return state;
}

export async function invalidateSession(token: string): Promise<void> {
	if (!isSessionToken(token)) {
		return;
	}

	await deleteSessionByTokenHash(hashSessionToken(token));
}

export async function deleteExpiredSessions(now = new Date()): Promise<void> {
	await deleteExpiredSessionRecords(now);
}

export function setSessionCookie(cookies: Cookies, token: string, expiresAt: Date): void {
	const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));

	cookies.set(serverConfig.sessionCookieName, token, {
		...cookieBaseOptions,
		expires: expiresAt,
		maxAge
	});
}

export function deleteSessionCookie(cookies: Cookies): void {
	cookies.delete(serverConfig.sessionCookieName, cookieBaseOptions);
}

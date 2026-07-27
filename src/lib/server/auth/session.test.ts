import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRepository } from '$lib/server/sessions/contract';

const mocks = vi.hoisted(() => ({
	getAuthPersistence: vi.fn()
}));

vi.mock('$lib/server/auth/persistence', () => ({
	getAuthPersistence: mocks.getAuthPersistence
}));

import {
	createSession,
	generateSessionToken,
	hashSessionToken,
	invalidateSession,
	validateSessionToken
} from './session';

function sessionRepository(): SessionRepository {
	return {
		createSession: vi.fn(),
		findValidSessionWithUser: vi.fn(),
		deleteSessionByTokenHash: vi.fn(),
		deleteSessionsForUser: vi.fn(),
		deleteExpiredSessions: vi.fn()
	};
}

describe('selected session repository service', () => {
	let sessions: SessionRepository;

	beforeEach(() => {
		sessions = sessionRepository();
		mocks.getAuthPersistence.mockResolvedValue({
			users: {},
			sessions
		});
	});

	it('hashes the cookie token before selected-repository validation', async () => {
		const token = generateSessionToken();
		vi.mocked(sessions.findValidSessionWithUser).mockResolvedValue(null);

		await expect(validateSessionToken(token)).resolves.toBeNull();
		expect(sessions.findValidSessionWithUser).toHaveBeenCalledWith(
			hashSessionToken(token),
			expect.any(Date)
		);
		expect(sessions.findValidSessionWithUser).not.toHaveBeenCalledWith(
			token,
			expect.anything()
		);
	});

	it('hashes the token before selected-repository logout deletion', async () => {
		const token = generateSessionToken();

		await invalidateSession(token);
		expect(sessions.deleteSessionByTokenHash).toHaveBeenCalledWith(
			hashSessionToken(token)
		);
	});

	it('creates only the prepared hashed session record', async () => {
		vi.mocked(sessions.createSession).mockImplementation(async (record) => ({
			...record,
			createdAt: new Date()
		}));

		const result = await createSession(
			'11111111-1111-4111-8111-111111111111'
		);
		expect(sessions.createSession).toHaveBeenCalledWith(
			expect.objectContaining({
				tokenHash: hashSessionToken(result.token)
			})
		);
		expect(JSON.stringify(vi.mocked(sessions.createSession).mock.calls)).not
			.toContain(result.token);
	});
});

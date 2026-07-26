import type { Collection, Document } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import type {
	SessionDocument,
	UserDocument
} from '../mongodb/documents';
import { createMongoSessionRepository } from './mongodb-repository';

const now = new Date('2026-07-27T12:00:00.000Z');
const sessionDocument: SessionDocument = {
	_id: '11111111-1111-4111-8111-111111111111',
	userId: '22222222-2222-4222-8222-222222222222',
	tokenHash: 'synthetic-token-hash',
	expiresAt: new Date('2026-07-27T13:00:00.000Z'),
	createdAt: now
};
const userDocument: UserDocument = {
	_id: sessionDocument.userId,
	username: 'fixture_user',
	email: 'fixture@example.test',
	passwordHash: 'synthetic-password-hash',
	createdAt: now,
	updatedAt: now
};

function collection<T extends Document>() {
	return {
		insertOne: vi.fn(),
		findOne: vi.fn(),
		deleteOne: vi.fn(),
		deleteMany: vi.fn()
	} as unknown as Collection<T>;
}

describe('MongoDB session repository', () => {
	it('rejects already expired session creation before insertion', async () => {
		const sessions = collection<SessionDocument>();
		const users = collection<UserDocument>();
		const repository = createMongoSessionRepository(sessions, users, {
			now: () => now
		});

		await expect(
			repository.createSession({
				id: sessionDocument._id,
				userId: sessionDocument.userId,
				tokenHash: sessionDocument.tokenHash,
				expiresAt: now
			})
		).rejects.toThrow('Cannot create an already expired session.');
		expect(sessions.insertOne).not.toHaveBeenCalled();
	});

	it('checks expiration explicitly and uses a safe user projection', async () => {
		const sessions = collection<SessionDocument>();
		const users = collection<UserDocument>();
		vi.mocked(sessions.findOne).mockResolvedValue(sessionDocument);
		vi.mocked(users.findOne).mockResolvedValue(userDocument);
		const repository = createMongoSessionRepository(sessions, users);

		await expect(
			repository.findValidSessionWithUser(
				sessionDocument.tokenHash,
				now
			)
		).resolves.toEqual({
			session: {
				id: sessionDocument._id,
				userId: sessionDocument.userId,
				expiresAt: sessionDocument.expiresAt,
				createdAt: sessionDocument.createdAt
			},
			user: {
				id: userDocument._id,
				username: userDocument.username,
				email: userDocument.email,
				createdAt: userDocument.createdAt
			}
		});
		expect(sessions.findOne).toHaveBeenCalledWith(
			{ tokenHash: sessionDocument.tokenHash },
			expect.objectContaining({
				projection: expect.not.objectContaining({
					tokenHash: expect.anything()
				})
			})
		);
		expect(users.findOne).toHaveBeenCalledWith(
			{ _id: sessionDocument.userId },
			expect.objectContaining({
				projection: expect.not.objectContaining({
					passwordHash: expect.anything()
				})
			})
		);
	});

	it('rejects a session whose user is missing', async () => {
		const sessions = collection<SessionDocument>();
		const users = collection<UserDocument>();
		vi.mocked(sessions.findOne).mockResolvedValue(sessionDocument);
		vi.mocked(users.findOne).mockResolvedValue(null);
		const repository = createMongoSessionRepository(sessions, users);

		await expect(
			repository.findValidSessionWithUser(
				sessionDocument.tokenHash,
				now
			)
		).resolves.toBeNull();
	});
});

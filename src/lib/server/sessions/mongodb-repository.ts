import type { Collection } from 'mongodb';
import type {
	SessionDocument,
	UserDocument
} from '../mongodb/documents.ts';
import type { SessionRepository } from './contract.ts';

export const MONGODB_SESSION_OPERATION_TIMEOUT_MS = 5_000;

export function createMongoSessionRepository(
	sessions: Collection<SessionDocument>,
	users: Collection<UserDocument>,
	options: { timeoutMS?: number; signal?: AbortSignal; now?: () => Date } = {}
): SessionRepository {
	const timeoutMS =
		options.timeoutMS ?? MONGODB_SESSION_OPERATION_TIMEOUT_MS;
	const operationOptions = { timeoutMS, signal: options.signal };

	return {
		async createSession(input, context) {
			const now = options.now?.() ?? new Date();
			if (input.expiresAt.getTime() <= now.getTime()) {
				throw new Error('Cannot create an already expired session.');
			}
			const document: SessionDocument = {
				_id: input.id,
				tokenHash: input.tokenHash,
				userId: input.userId,
				expiresAt: input.expiresAt,
				createdAt: now
			};
			await sessions.insertOne(document, {
				...operationOptions,
				session: context?.mongoSession
			});
			return {
				id: document._id,
				userId: document.userId,
				expiresAt: document.expiresAt,
				createdAt: document.createdAt
			};
		},
		async findValidSessionWithUser(tokenHash, now) {
			const session = await sessions.findOne(
				{ tokenHash },
				{
					...operationOptions,
					projection: {
						_id: 1,
						userId: 1,
						expiresAt: 1,
						createdAt: 1
					}
				}
			);
			if (!session) return null;
			if (session.expiresAt.getTime() <= now.getTime()) {
				await sessions.deleteOne({ tokenHash }, operationOptions);
				return null;
			}

			const user = await users.findOne(
				{ _id: session.userId },
				{
					...operationOptions,
					projection: {
						_id: 1,
						username: 1,
						email: 1,
						createdAt: 1
					}
				}
			);
			if (!user) return null;

			return {
				session: {
					id: session._id,
					userId: session.userId,
					expiresAt: session.expiresAt,
					createdAt: session.createdAt
				},
				user: {
					id: user._id,
					username: user.username,
					email: user.email,
					createdAt: user.createdAt
				}
			};
		},
		async deleteSessionByTokenHash(tokenHash) {
			await sessions.deleteOne({ tokenHash }, operationOptions);
		},
		async deleteSessionsForUser(userId) {
			await sessions.deleteMany({ userId }, operationOptions);
		},
		async deleteExpiredSessions(now) {
			await sessions.deleteMany(
				{ expiresAt: { $lte: now } },
				operationOptions
			);
		}
	};
}

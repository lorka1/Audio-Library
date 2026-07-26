import { eq, lt } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { sessions, users } from '$lib/server/db/schema';
import type { SessionRepository } from './contract';

const safeUserSelection = {
	id: users.id,
	username: users.username,
	email: users.email,
	createdAt: users.createdAt
};

const safeSessionSelection = {
	id: sessions.id,
	userId: sessions.userId,
	expiresAt: sessions.expiresAt,
	createdAt: sessions.createdAt
};

export function createSqliteSessionRepository(
	database: typeof db = db
): SessionRepository {
	return {
		async createSession(input) {
			const [session] = await database
				.insert(sessions)
				.values(input)
				.returning(safeSessionSelection);
			if (!session) {
				throw new Error('The database did not return the created session.');
			}
			return session;
		},
		async findValidSessionWithUser(tokenHash, now) {
			const [result] = await database
				.select({ session: safeSessionSelection, user: safeUserSelection })
				.from(sessions)
				.innerJoin(users, eq(sessions.userId, users.id))
				.where(eq(sessions.tokenHash, tokenHash))
				.limit(1);
			if (!result) return null;
			if (result.session.expiresAt.getTime() <= now.getTime()) {
				await database
					.delete(sessions)
					.where(eq(sessions.tokenHash, tokenHash));
				return null;
			}
			return result;
		},
		async deleteSessionByTokenHash(tokenHash) {
			await database
				.delete(sessions)
				.where(eq(sessions.tokenHash, tokenHash));
		},
		async deleteSessionsForUser(userId) {
			await database.delete(sessions).where(eq(sessions.userId, userId));
		},
		async deleteExpiredSessions(now) {
			await database.delete(sessions).where(lt(sessions.expiresAt, now));
		}
	};
}

export const sqliteSessionRepository =
	createSqliteSessionRepository();

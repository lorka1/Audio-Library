import type { CurrentUser } from '$lib/types';
import { eq, lt } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { sessions, users } from '$lib/server/db/schema';
import type {
	AuthSession,
	AuthState,
	CreateSessionRecordInput,
	CreateUserInput
} from './types';

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

export async function createUserWithSession(
	userInput: CreateUserInput,
	sessionInput: CreateSessionRecordInput
): Promise<{ user: CurrentUser; session: AuthSession }> {
	return db.transaction(async (transaction) => {
		const [user] = await transaction
			.insert(users)
			.values(userInput)
			.returning(safeUserSelection);
		const [session] = await transaction
			.insert(sessions)
			.values(sessionInput)
			.returning(safeSessionSelection);

		if (!user || !session) {
			throw new Error('The database did not return the created authentication records.');
		}

		return { user, session };
	});
}

export async function createSessionRecord(
	input: CreateSessionRecordInput
): Promise<AuthSession> {
	const [session] = await db.insert(sessions).values(input).returning(safeSessionSelection);

	if (!session) {
		throw new Error('The database did not return the created session.');
	}

	return session;
}

export async function findSessionWithUserByTokenHash(
	tokenHash: string
): Promise<AuthState | null> {
	const [result] = await db
		.select({
			session: safeSessionSelection,
			user: safeUserSelection
		})
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(eq(sessions.tokenHash, tokenHash))
		.limit(1);

	return result ?? null;
}

export async function deleteSessionById(sessionId: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function deleteSessionByTokenHash(tokenHash: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

export async function deleteExpiredSessionRecords(now: Date): Promise<void> {
	await db.delete(sessions).where(lt(sessions.expiresAt, now));
}

import type { CurrentUser } from '$lib/types';
import { db } from '$lib/server/db';
import { sessions, users } from '$lib/server/db/schema';
import type {
	AuthSession,
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

import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import type { UserRepository } from './contract';
import { assertNormalizedCreateUserInput } from './contract';
import { DuplicateUserError } from './types';

const safeUserSelection = {
	id: users.id,
	username: users.username,
	email: users.email,
	createdAt: users.createdAt
};

const authenticationUserSelection = {
	id: users.id,
	passwordHash: users.passwordHash
};

const accountUserSelection = {
	username: users.username,
	email: users.email,
	createdAt: users.createdAt
};

export type SqliteUserDatabase = typeof db;

export function createSqliteUserRepository(
	database: SqliteUserDatabase = db
): UserRepository {
	const repository: UserRepository = {
		async createUser(input) {
			assertNormalizedCreateUserInput(input);

			try {
				const [user] = await database
					.insert(users)
					.values(input)
					.returning(safeUserSelection);

				if (!user) {
					throw new Error('The database did not return the created user.');
				}

				return user;
			} catch (error) {
				const conflicts = await repository
					.findRegistrationConflicts(input.username, input.email)
					.catch(() => null);

				if (conflicts?.usernameTaken) {
					throw new DuplicateUserError('username');
				}

				if (conflicts?.emailTaken) {
					throw new DuplicateUserError('email');
				}

				throw error;
			}
		},

		async findUserById(id) {
			const [user] = await database
				.select(safeUserSelection)
				.from(users)
				.where(eq(users.id, id))
				.limit(1);
			return user ?? null;
		},

		async findUserByNormalizedUsername(username) {
			const [user] = await database
				.select(safeUserSelection)
				.from(users)
				.where(eq(users.username, username))
				.limit(1);
			return user ?? null;
		},

		async findUserByNormalizedEmail(email) {
			const [user] = await database
				.select(safeUserSelection)
				.from(users)
				.where(eq(users.email, email))
				.limit(1);
			return user ?? null;
		},

		async findAuthenticationUser(normalizedEmail) {
			const [user] = await database
				.select(authenticationUserSelection)
				.from(users)
				.where(eq(users.email, normalizedEmail))
				.limit(1);
			return user ?? null;
		},

		async findAccountUserById(id) {
			const [user] = await database
				.select(accountUserSelection)
				.from(users)
				.where(eq(users.id, id))
				.limit(1);
			return user ?? null;
		},

		async findRegistrationConflicts(normalizedUsername, normalizedEmail) {
			const [usernameMatch, emailMatch] = await Promise.all([
				repository.findUserByNormalizedUsername(normalizedUsername),
				repository.findUserByNormalizedEmail(normalizedEmail)
			]);

			return {
				usernameTaken: usernameMatch !== null,
				emailTaken: emailMatch !== null
			};
		}
	};

	return repository;
}

export const sqliteUserRepository = createSqliteUserRepository();

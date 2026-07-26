import {
	MongoServerError,
	type Collection,
	type FindOptions
} from 'mongodb';
import type { UserDocument } from '../mongodb/documents.ts';
import type { UserRepository } from './contract.ts';
import { assertNormalizedCreateUserInput } from './contract.ts';
import {
	DuplicateUserError,
	type AuthenticationUser,
	type SafeAccountUser,
	type SafeUser
} from './types.ts';

export const MONGODB_USER_OPERATION_TIMEOUT_MS = 5_000;

export interface MongoUserRepositoryOptions {
	timeoutMS?: number;
	signal?: AbortSignal;
	now?: () => Date;
}

const safeUserProjection = {
	_id: 1,
	username: 1,
	email: 1,
	createdAt: 1
} as const;

const authenticationUserProjection = {
	_id: 1,
	passwordHash: 1
} as const;

const accountUserProjection = {
	_id: 0,
	username: 1,
	email: 1,
	createdAt: 1
} as const;

function toSafeUser(document: UserDocument): SafeUser {
	return {
		id: document._id,
		username: document.username,
		email: document.email,
		createdAt: document.createdAt
	};
}

function toAuthenticationUser(
	document: UserDocument
): AuthenticationUser {
	return {
		id: document._id,
		passwordHash: document.passwordHash
	};
}

function toSafeAccountUser(
	document: UserDocument
): SafeAccountUser {
	return {
		username: document.username,
		email: document.email,
		createdAt: document.createdAt
	};
}

function duplicateField(
	error: unknown
): 'username' | 'email' | null {
	if (!(error instanceof MongoServerError) || error.code !== 11000) {
		return null;
	}

	const keyPattern = error.keyPattern as
		| Record<string, unknown>
		| undefined;

	if (keyPattern && Object.hasOwn(keyPattern, 'username')) {
		return 'username';
	}

	if (keyPattern && Object.hasOwn(keyPattern, 'email')) {
		return 'email';
	}

	return null;
}

export function createMongoUserRepository(
	users: Collection<UserDocument>,
	options: MongoUserRepositoryOptions = {}
): UserRepository {
	const timeoutMS =
		options.timeoutMS ?? MONGODB_USER_OPERATION_TIMEOUT_MS;
	const operationOptions = {
		timeoutMS,
		signal: options.signal
	};
	const findOptions = (
		projection: FindOptions['projection']
	): FindOptions => ({
		...operationOptions,
		projection
	});

	const repository: UserRepository = {
		async createUser(input) {
			assertNormalizedCreateUserInput(input);
			const now = options.now?.() ?? new Date();
			const document: UserDocument = {
				_id: input.id,
				username: input.username,
				email: input.email,
				passwordHash: input.passwordHash,
				createdAt: now,
				updatedAt: now
			};

			try {
				await users.insertOne(document, operationOptions);
			} catch (error) {
				const field = duplicateField(error);

				if (field) {
					throw new DuplicateUserError(field);
				}

				throw error;
			}

			return toSafeUser(document);
		},

		async findUserById(id) {
			const user = await users.findOne(
				{ _id: id },
				findOptions(safeUserProjection)
			);
			return user ? toSafeUser(user) : null;
		},

		async findUserByNormalizedUsername(username) {
			const user = await users.findOne(
				{ username },
				findOptions(safeUserProjection)
			);
			return user ? toSafeUser(user) : null;
		},

		async findUserByNormalizedEmail(email) {
			const user = await users.findOne(
				{ email },
				findOptions(safeUserProjection)
			);
			return user ? toSafeUser(user) : null;
		},

		async findAuthenticationUser(normalizedEmail) {
			const user = await users.findOne(
				{ email: normalizedEmail },
				findOptions(authenticationUserProjection)
			);
			return user ? toAuthenticationUser(user) : null;
		},

		async findAccountUserById(id) {
			const user = await users.findOne(
				{ _id: id },
				findOptions(accountUserProjection)
			);
			return user ? toSafeAccountUser(user) : null;
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

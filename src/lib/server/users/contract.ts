import type { CreateUserInput } from '../auth/types.ts';
import type { ClientSession } from 'mongodb';
import type { CurrentUser } from '../../types';
import {
	normalizeEmail,
	validateEmail,
	validateUsername
} from '../auth/validation.ts';

export interface AuthenticationUser {
	id: string;
	passwordHash: string;
}

export interface RegistrationConflicts {
	usernameTaken: boolean;
	emailTaken: boolean;
}

export type DuplicateUserField = 'username' | 'email';

export class DuplicateUserError extends Error {
	readonly field: DuplicateUserField;

	constructor(field: DuplicateUserField) {
		super(`A user with that ${field} already exists.`);
		this.name = 'DuplicateUserError';
		this.field = field;
	}
}

export type SafeUser = CurrentUser;

export interface SafeAccountUser {
	username: string;
	email: string;
	createdAt: Date;
}

export interface UserRepository {
	createUser(
		input: CreateUserInput,
		context?: { mongoSession?: ClientSession }
	): Promise<SafeUser>;
	findUserById(id: string): Promise<SafeUser | null>;
	findUserByNormalizedUsername(username: string): Promise<SafeUser | null>;
	findUserByNormalizedEmail(email: string): Promise<SafeUser | null>;
	findAuthenticationUser(
		normalizedEmail: string
	): Promise<AuthenticationUser | null>;
	findAccountUserById(id: string): Promise<SafeAccountUser | null>;
	findRegistrationConflicts(
		normalizedUsername: string,
		normalizedEmail: string
	): Promise<RegistrationConflicts>;
}

export function assertNormalizedCreateUserInput(
	input: CreateUserInput
): void {
	if (
		input.username !== input.username.trim() ||
		validateUsername(input.username)
	) {
		throw new Error('User repository received an invalid username.');
	}

	if (
		input.email !== normalizeEmail(input.email) ||
		validateEmail(input.email)
	) {
		throw new Error('User repository received an invalid normalized email.');
	}

	if (!input.id.trim() || !input.passwordHash.trim()) {
		throw new Error('User repository received incomplete server-only fields.');
	}
}

import type { CreateUserInput } from '../auth/types.ts';
import type { ClientSession } from 'mongodb';
import {
	normalizeEmail,
	validateEmail,
	validateUsername
} from '../auth/validation.ts';
import type {
	AuthenticationUser,
	RegistrationConflicts,
	SafeAccountUser,
	SafeUser
} from './types';

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

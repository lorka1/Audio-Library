import type { CreateUserInput } from '$lib/server/auth/types';
import { getAuthPersistence } from '$lib/server/auth/persistence';

export function createUser(input: CreateUserInput) {
	return getAuthPersistence().then(({ users }) =>
		users.createUser(input)
	);
}

export function findUserById(id: string) {
	return getAuthPersistence().then(({ users }) =>
		users.findUserById(id)
	);
}

export function findUserByNormalizedUsername(username: string) {
	return getAuthPersistence().then(({ users }) =>
		users.findUserByNormalizedUsername(username)
	);
}

export function findUserByNormalizedEmail(email: string) {
	return getAuthPersistence().then(({ users }) =>
		users.findUserByNormalizedEmail(email)
	);
}

export function findAuthenticationUser(normalizedEmail: string) {
	return getAuthPersistence().then(({ users }) =>
		users.findAuthenticationUser(normalizedEmail)
	);
}

export function findAccountUserById(id: string) {
	return getAuthPersistence().then(({ users }) =>
		users.findAccountUserById(id)
	);
}

export function findRegistrationConflicts(
	normalizedUsername: string,
	normalizedEmail: string
) {
	return getAuthPersistence().then(({ users }) =>
		users.findRegistrationConflicts(normalizedUsername, normalizedEmail)
	);
}

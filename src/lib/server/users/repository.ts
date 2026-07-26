import type { CreateUserInput } from '$lib/server/auth/types';
import type { DatabaseBackendEnvironment } from './backend';
import { getAuthPersistence } from '$lib/server/auth/persistence';

export function createUser(
	input: CreateUserInput,
	environment?: DatabaseBackendEnvironment
) {
	return getAuthPersistence(environment).then(({ users }) =>
		users.createUser(input)
	);
}

export function findUserById(
	id: string,
	environment?: DatabaseBackendEnvironment
) {
	return getAuthPersistence(environment).then(({ users }) =>
		users.findUserById(id)
	);
}

export function findUserByNormalizedUsername(
	username: string,
	environment?: DatabaseBackendEnvironment
) {
	return getAuthPersistence(environment).then(({ users }) =>
		users.findUserByNormalizedUsername(username)
	);
}

export function findUserByNormalizedEmail(
	email: string,
	environment?: DatabaseBackendEnvironment
) {
	return getAuthPersistence(environment).then(({ users }) =>
		users.findUserByNormalizedEmail(email)
	);
}

export function findAuthenticationUser(
	normalizedEmail: string,
	environment?: DatabaseBackendEnvironment
) {
	return getAuthPersistence(environment).then(({ users }) =>
		users.findAuthenticationUser(normalizedEmail)
	);
}

export function findAccountUserById(
	id: string,
	environment?: DatabaseBackendEnvironment
) {
	return getAuthPersistence(environment).then(({ users }) =>
		users.findAccountUserById(id)
	);
}

export function findRegistrationConflicts(
	normalizedUsername: string,
	normalizedEmail: string,
	environment?: DatabaseBackendEnvironment
) {
	return getAuthPersistence(environment).then(({ users }) =>
		users.findRegistrationConflicts(normalizedUsername, normalizedEmail)
	);
}

import type { CreateUserInput } from '$lib/server/auth/types';
import type { DatabaseBackendEnvironment } from './backend';
import { requireM2ApplicationBackend } from './backend';
import { sqliteUserRepository } from './sqlite-repository';

function applicationRepository(
	environment: DatabaseBackendEnvironment = process.env
) {
	requireM2ApplicationBackend(environment);
	return sqliteUserRepository;
}

export function createUser(
	input: CreateUserInput,
	environment?: DatabaseBackendEnvironment
) {
	return applicationRepository(environment).createUser(input);
}

export function findUserById(
	id: string,
	environment?: DatabaseBackendEnvironment
) {
	return applicationRepository(environment).findUserById(id);
}

export function findUserByNormalizedUsername(
	username: string,
	environment?: DatabaseBackendEnvironment
) {
	return applicationRepository(environment).findUserByNormalizedUsername(
		username
	);
}

export function findUserByNormalizedEmail(
	email: string,
	environment?: DatabaseBackendEnvironment
) {
	return applicationRepository(environment).findUserByNormalizedEmail(email);
}

export function findAuthenticationUser(
	normalizedEmail: string,
	environment?: DatabaseBackendEnvironment
) {
	return applicationRepository(environment).findAuthenticationUser(
		normalizedEmail
	);
}

export function findAccountUserById(
	id: string,
	environment?: DatabaseBackendEnvironment
) {
	return applicationRepository(environment).findAccountUserById(id);
}

export function findRegistrationConflicts(
	normalizedUsername: string,
	normalizedEmail: string,
	environment?: DatabaseBackendEnvironment
) {
	return applicationRepository(environment).findRegistrationConflicts(
		normalizedUsername,
		normalizedEmail
	);
}

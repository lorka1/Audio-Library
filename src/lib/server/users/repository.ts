import { getAuthPersistence } from '$lib/server/auth/persistence';

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

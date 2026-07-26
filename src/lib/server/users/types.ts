import type { AccountUser } from '$lib/account-user';
import type { CurrentUser } from '$lib/types';

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
export type SafeAccountUser = AccountUser;

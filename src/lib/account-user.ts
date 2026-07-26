import type { CurrentUser } from '$lib/types';

export interface AccountUser {
	username: string;
	email: string;
	createdAt: Date;
}

export function toAccountUser(user: CurrentUser): AccountUser {
	return {
		username: user.username,
		email: user.email,
		createdAt: user.createdAt
	};
}

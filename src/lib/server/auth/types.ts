import type { CurrentUser } from '$lib/types';

export interface AuthSession {
	id: string;
	userId: string;
	expiresAt: Date;
	createdAt: Date;
}

export interface AuthState {
	user: CurrentUser;
	session: AuthSession;
}

export interface CreateUserInput {
	id: string;
	username: string;
	email: string;
	passwordHash: string;
}

export interface CreateSessionRecordInput {
	id: string;
	userId: string;
	tokenHash: string;
	expiresAt: Date;
}

export interface PreparedSession {
	token: string;
	record: CreateSessionRecordInput;
}

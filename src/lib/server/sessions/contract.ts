import type { ClientSession } from 'mongodb';
import type {
	AuthSession,
	AuthState,
	CreateSessionRecordInput
} from '../auth/types.ts';

export interface SessionWriteContext {
	mongoSession?: ClientSession;
}

export interface SessionRepository {
	createSession(
		input: CreateSessionRecordInput,
		context?: SessionWriteContext
	): Promise<AuthSession>;
	findValidSessionWithUser(
		tokenHash: string,
		now: Date
	): Promise<AuthState | null>;
	deleteSessionByTokenHash(tokenHash: string): Promise<void>;
	deleteSessionsForUser(userId: string): Promise<void>;
	deleteExpiredSessions(now: Date): Promise<void>;
}

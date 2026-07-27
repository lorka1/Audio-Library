import type { MongoClient } from 'mongodb';
import type { CurrentUser } from '$lib/types';
import {
	connectMongoDevelopment
} from '../mongodb/client';
import { getMongoCollections } from '../mongodb/collections';
import {
	createMongoUserRepository
} from '../users/mongodb-repository';
import {
	createMongoSessionRepository
} from '../sessions/mongodb-repository';
import type { SessionRepository } from '../sessions/contract';
import type { UserRepository } from '../users/contract';
import type {
	AuthSession,
	CreateSessionRecordInput,
	CreateUserInput
} from './types';
import { logAuthError } from './logging';
import { cleanupPreservingPrimaryFailure } from '../operational/cleanup';

const TRANSACTION_TIMEOUT_MS = 8_000;

export interface AuthPersistence {
	users: UserRepository;
	sessions: SessionRepository;
	createUserWithSession(
		userInput: CreateUserInput,
		sessionInput: CreateSessionRecordInput
	): Promise<{ user: CurrentUser; session: AuthSession }>;
}

async function assertTransactionSupport(client: MongoClient): Promise<void> {
	const hello = await client
		.db('admin')
		.command({ hello: 1 }, { timeoutMS: TRANSACTION_TIMEOUT_MS });
	if (
		typeof hello.setName !== 'string' &&
		hello.msg !== 'isdbgrid'
	) {
		throw new Error(
			'MongoDB auth requires a replica set or sharded deployment with transaction support.'
		);
	}
}

let mongoAuthPersistencePromise: Promise<AuthPersistence> | undefined;

function mongoAuthPersistence(): Promise<AuthPersistence> {
	if (mongoAuthPersistencePromise) {
		return mongoAuthPersistencePromise;
	}
	const attempt: Promise<AuthPersistence> = (async () => {
		const { client, database } = await connectMongoDevelopment();
		await assertTransactionSupport(client);
		const collections = getMongoCollections(database);
		const users = createMongoUserRepository(collections.users);
		const sessions = createMongoSessionRepository(
			collections.sessions,
			collections.users
		);

		const persistence: AuthPersistence = {
			users,
			sessions,
			async createUserWithSession(
				userInput: CreateUserInput,
				sessionInput: CreateSessionRecordInput
			) {
				const clientSession = client.startSession();
				let result:
					| { user: CurrentUser; session: AuthSession }
					| undefined;
				let primaryFailure: unknown;
				try {
					await clientSession.withTransaction(
						async () => {
							const user = await users.createUser(userInput, {
								mongoSession: clientSession
							});
							const session = await sessions.createSession(
								sessionInput,
								{ mongoSession: clientSession }
							);
							result = { user, session };
						},
						{
							maxCommitTimeMS: TRANSACTION_TIMEOUT_MS,
							readPreference: 'primary',
							readConcern: { level: 'snapshot' },
							writeConcern: { w: 'majority' }
						}
					);
				} catch (error) {
					primaryFailure = error;
					throw error;
				} finally {
					await cleanupPreservingPrimaryFailure(
						primaryFailure,
						() => clientSession.endSession(),
						(cleanupError) =>
							logAuthError('Unable to close a MongoDB transaction session.', cleanupError)
					);
				}
				if (!result) {
					throw new Error(
						'MongoDB registration transaction did not commit.'
					);
				}
				return result;
			}
		};
		return persistence;
	})();
	mongoAuthPersistencePromise = attempt.catch((error) => {
		if (mongoAuthPersistencePromise === attempt) {
			mongoAuthPersistencePromise = undefined;
		}
		throw error;
	});
	return mongoAuthPersistencePromise;
}

export async function getAuthPersistence(): Promise<AuthPersistence> {
	return mongoAuthPersistence();
}

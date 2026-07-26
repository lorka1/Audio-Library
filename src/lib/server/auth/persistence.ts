import type { MongoClient } from 'mongodb';
import type { CurrentUser } from '$lib/types';
import {
	connectMongoDevelopment
} from '../mongodb/client';
import { getMongoCollections } from '../mongodb/collections';
import {
	readDatabaseBackend,
	type DatabaseBackend,
	type DatabaseBackendEnvironment
} from '../users/backend';
import {
	createMongoUserRepository
} from '../users/mongodb-repository';
import { sqliteUserRepository } from '../users/sqlite-repository';
import {
	createMongoSessionRepository
} from '../sessions/mongodb-repository';
import { sqliteSessionRepository } from '../sessions/sqlite-repository';
import type { SessionRepository } from '../sessions/contract';
import type { UserRepository } from '../users/contract';
import type {
	AuthSession,
	CreateSessionRecordInput,
	CreateUserInput
} from './types';
import { createUserWithSession as createSqliteUserWithSession } from './repository';

const TRANSACTION_TIMEOUT_MS = 8_000;

export interface AuthPersistence {
	backend: DatabaseBackend;
	users: UserRepository;
	sessions: SessionRepository;
	createUserWithSession(
		userInput: CreateUserInput,
		sessionInput: CreateSessionRecordInput
	): Promise<{ user: CurrentUser; session: AuthSession }>;
}

export function authBackendPair<T>(
	backend: DatabaseBackend,
	sqlite: T,
	mongodb: T
): T {
	return backend === 'sqlite' ? sqlite : mongodb;
}

const sqliteAuthPersistence: AuthPersistence = {
	backend: 'sqlite',
	users: sqliteUserRepository,
	sessions: sqliteSessionRepository,
	createUserWithSession: createSqliteUserWithSession
};

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
			backend: 'mongodb',
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
				} finally {
					await clientSession.endSession();
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

export async function getAuthPersistence(
	environment: DatabaseBackendEnvironment = process.env
): Promise<AuthPersistence> {
	const backend = readDatabaseBackend(environment);
	return backend === 'sqlite'
		? sqliteAuthPersistence
		: mongoAuthPersistence();
}

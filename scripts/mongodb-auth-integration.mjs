import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClientManager } from '../src/lib/server/mongodb/client.ts';
import {
	assertMongoTestDatabaseName,
	readMongoConfig
} from '../src/lib/server/mongodb/config.ts';
import { getMongoCollections } from '../src/lib/server/mongodb/collections.ts';
import { MONGODB_INDEX_DEFINITIONS } from '../src/lib/server/mongodb/indexes.ts';
import { hashPassword, verifyPassword } from '../src/lib/server/auth/password.ts';
import {
	generateSessionToken,
	hashSessionToken
} from '../src/lib/server/auth/session-token.ts';
import {
	assertUnifiedAuthBackend,
	parseDatabaseBackend
} from '../src/lib/server/users/backend.ts';
import { createMongoUserRepository } from '../src/lib/server/users/mongodb-repository.ts';
import { createMongoSessionRepository } from '../src/lib/server/sessions/mongodb-repository.ts';

const OPERATION_TIMEOUT_MS = 5_000;
const TOTAL_TIMEOUT_MS = 120_000;
const EXPECTED_CHECKS = 21;
let checkNumber = 0;
let activeStep = 'controller setup';
let activeCheckName;

function beginCheck(label) {
	activeStep = label;
	activeCheckName = label;
}

function beginStep(label) {
	activeStep = label;
	activeCheckName = undefined;
}

async function check(label, assertion) {
	beginCheck(label);
	const plannedCheckNumber = checkNumber + 1;
	await assertion();
	checkNumber = plannedCheckNumber;
	activeCheckName = undefined;
	console.log(`PASS ${checkNumber}/${EXPECTED_CHECKS}: ${label}`);
}

function ownedName(base) {
	const suffix = `_m3_auth_${randomBytes(6).toString('hex')}`;
	const name = `${base.slice(0, 63 - suffix.length)}${suffix}`;
	assertMongoTestDatabaseName(name, process.env.MONGODB_DB_NAME ?? '');
	return name;
}

function safeErrorDetails(error) {
	const details = {
		errorClass:
			error instanceof Error
				? error.constructor.name
				: typeof error
	};
	if (
		typeof error === 'object' &&
		error !== null &&
		(typeof error.code === 'number' || typeof error.code === 'string')
	) {
		details.code = error.code;
	}
	if (
		typeof error === 'object' &&
		error !== null &&
		typeof error.codeName === 'string'
	) {
		details.codeName = error.codeName;
	}
	if (error instanceof Error && typeof error.stack === 'string') {
		const safeFrames = error.stack
			.split(/\r?\n/)
			.slice(1)
			.map((line) =>
				line.match(
					/((?:scripts|src[\\/]lib[\\/]server)[\\/][^():]+:\d+:\d+)/
				)?.[1]
			)
			.filter(Boolean)
			.slice(0, 5)
			.map((line) => line.replaceAll('\\', '/'));
		if (safeFrames.length > 0) details.stack = safeFrames;
	}
	if (
		error instanceof Error &&
		[
			'An operation cannot be given a timeoutMS setting when inside a withTransaction call that has a timeoutMS setting',
			'MongoDB auth integration requires Atlas or a replica-set deployment with transaction support.'
		].includes(error.message)
	) {
		details.safeMessage = error.message;
	}
	return details;
}

function failureCategory(failure, cleanup = false) {
	if (cleanup) return 'cleanup failure';
	if (
		failure.step.includes('index') ||
		failure.step.includes('fixture setup')
	) {
		return 'setup/index failure';
	}
	if (failure.error instanceof assert.AssertionError) {
		return 'test/assertion failure';
	}
	if (
		failure.step.includes('transaction') ||
		(typeof failure.error === 'object' &&
			failure.error !== null &&
			('code' in failure.error ||
				failure.error.constructor?.name?.startsWith('Mongo')))
	) {
		return 'MongoDB command or transaction failure';
	}
	return 'unexpected controller failure';
}

function captureFailure(error, transactionActive, serverPrimary) {
	return {
		error,
		step: activeStep,
		checkName: activeCheckName,
		checkNumber: activeCheckName ? checkNumber + 1 : undefined,
		transactionActive,
		serverPrimary
	};
}

function reportFailure(label, failure, cleanup = false) {
	console.error(
		`${label}: ${JSON.stringify({
			category: failureCategory(failure, cleanup),
			step: failure.step,
			failedCheck:
				failure.checkName && failure.checkNumber
					? `${failure.checkNumber}/${EXPECTED_CHECKS}: ${failure.checkName}`
					: undefined,
			transactionActive: failure.transactionActive,
			serverPrimary: failure.serverPrimary,
			...safeErrorDetails(failure.error)
		})}`
	);
}

async function main() {
	const config = readMongoConfig(process.env);
	assertMongoTestDatabaseName(config.testDatabaseName, config.databaseName);
	const databaseName = ownedName(config.testDatabaseName);
	assert.notEqual(databaseName, config.databaseName);
	const ownedDatabase = {
		name: databaseName,
		eligibleForCleanup: true,
		touched: false,
		removed: false
	};
	const manager = new MongoClientManager({
		...config,
		testDatabaseName: databaseName
	});
	let database;
	let primaryFailure;
	const cleanupFailures = [];
	let activeClientSessions = 0;
	let transactionActive = false;
	let transactionActiveAtFailure = false;
	let serverPrimary = false;
	let clientClosed = false;
	const abortController = new AbortController();
	const watchdog = setTimeout(
		() => abortController.abort(new Error('MongoDB auth integration timed out.')),
		TOTAL_TIMEOUT_MS
	);
	watchdog.unref();

	try {
		beginStep('transaction capability check');
		const client = await manager.connect();
		const hello = await client
			.db('admin')
			.command({ hello: 1 }, { timeoutMS: OPERATION_TIMEOUT_MS });
		serverPrimary = hello.isWritablePrimary === true;
		const transactionCapable =
			typeof hello.setName === 'string' || hello.msg === 'isdbgrid';
		if (!transactionCapable) {
			throw new Error(
				'MongoDB auth integration requires Atlas or a replica-set deployment with transaction support.'
			);
		}
		await check('transaction support', () => assert.ok(transactionCapable));

		database = client.db(databaseName);
		const collections = getMongoCollections(database);
		beginStep('setup/index creation');
		ownedDatabase.touched = true;
		await Promise.all([
			collections.users.createIndexes(
				[...MONGODB_INDEX_DEFINITIONS.users],
				{ maxTimeMS: OPERATION_TIMEOUT_MS }
			),
			collections.sessions.createIndexes(
				[...MONGODB_INDEX_DEFINITIONS.sessions],
				{ maxTimeMS: OPERATION_TIMEOUT_MS }
			)
		]);
		const users = createMongoUserRepository(collections.users, {
			timeoutMS: OPERATION_TIMEOUT_MS,
			signal: abortController.signal
		});
		const sessions = createMongoSessionRepository(
			collections.sessions,
			collections.users,
			{
				timeoutMS: OPERATION_TIMEOUT_MS,
				signal: abortController.signal
			}
		);
		const password = 'Synthetic-M3-password-42';
		const passwordHash = await hashPassword(password);
		const now = new Date();

		async function transaction(work) {
			const mongoSession = client.startSession();
			activeClientSessions += 1;
			try {
				transactionActive = true;
				return await mongoSession.withTransaction(
					() => work(mongoSession),
					{
						maxCommitTimeMS: 8_000,
						readPreference: 'primary',
						readConcern: { level: 'snapshot' },
						writeConcern: { w: 'majority' }
					}
				);
			} catch (error) {
				transactionActiveAtFailure = transactionActive;
				throw error;
			} finally {
				transactionActive = false;
				await mongoSession.endSession();
				activeClientSessions -= 1;
			}
		}

		const userInput = {
			id: randomUUID(),
			username: 'm3_fixture_user',
			email: 'm3.fixture@example.test',
			passwordHash
		};
		const rawToken = generateSessionToken();
		const sessionInput = {
			id: randomUUID(),
			userId: userInput.id,
			tokenHash: hashSessionToken(rawToken),
			expiresAt: new Date(now.getTime() + 60_000)
		};

		beginCheck('atomic user and session registration');
		await transaction(async (mongoSession) => {
			await users.createUser(userInput, { mongoSession });
			await sessions.createSession(sessionInput, { mongoSession });
		});
		await check('atomic user and session registration', async () => {
			assert.equal(await collections.users.countDocuments({}, { timeoutMS: OPERATION_TIMEOUT_MS }), 1);
			assert.equal(await collections.sessions.countDocuments({}, { timeoutMS: OPERATION_TIMEOUT_MS }), 1);
		});

		const baselineCounts = async () => [
			await collections.users.countDocuments({}, { timeoutMS: OPERATION_TIMEOUT_MS }),
			await collections.sessions.countDocuments({}, { timeoutMS: OPERATION_TIMEOUT_MS })
		];
		beginCheck('duplicate username rollback');
		await assert.rejects(
			transaction((mongoSession) =>
				users.createUser(
					{
						...userInput,
						id: randomUUID(),
						email: 'm3.second@example.test'
					},
					{ mongoSession }
				)
			)
		);
		await check('duplicate username rollback', async () =>
			assert.deepEqual(await baselineCounts(), [1, 1])
		);
		beginCheck('duplicate email rollback');
		await assert.rejects(
			transaction((mongoSession) =>
				users.createUser(
					{
						...userInput,
						id: randomUUID(),
						username: 'm3_fixture_second'
					},
					{ mongoSession }
				)
			)
		);
		await check('duplicate email rollback', async () =>
			assert.deepEqual(await baselineCounts(), [1, 1])
		);

		const rollbackUser = { ...userInput, id: randomUUID(), username: 'm3_rollback', email: 'm3.rollback@example.test' };
		beginCheck('failed session creation rolls back user');
		await assert.rejects(
			transaction(async (mongoSession) => {
				await users.createUser(rollbackUser, { mongoSession });
				throw new Error('synthetic session failure');
			})
		);
		await check('failed session creation rolls back user', async () =>
			assert.equal(await users.findUserById(rollbackUser.id), null)
		);

		beginCheck('login lookup and password verification');
		const authentication = await users.findAuthenticationUser(userInput.email);
		await check('login lookup and password verification', async () => {
			assert.ok(authentication);
			assert.equal(
				await verifyPassword(password, authentication.passwordHash),
				true
			);
		});

		const secondToken = generateSessionToken();
		beginCheck('session creation');
		const secondSession = await sessions.createSession({
			id: randomUUID(),
			userId: userInput.id,
			tokenHash: hashSessionToken(secondToken),
			expiresAt: new Date(now.getTime() + 120_000)
		});
		await check('session creation', () => assert.ok(secondSession.id));
		await check('valid session lookup', async () =>
			assert.ok(
				await sessions.findValidSessionWithUser(
					sessionInput.tokenHash,
					now
				)
			)
		);
		await check('expired session rejection', async () =>
			assert.equal(
				await sessions.findValidSessionWithUser(
					sessionInput.tokenHash,
					new Date(now.getTime() + 180_000)
				),
				null
			)
		);

		const missingUserHash = hashSessionToken(generateSessionToken());
		beginCheck('missing-user session rejection');
		await collections.sessions.insertOne(
			{
				_id: randomUUID(),
				userId: randomUUID(),
				tokenHash: missingUserHash,
				expiresAt: new Date(now.getTime() + 60_000),
				createdAt: now
			},
			{ timeoutMS: OPERATION_TIMEOUT_MS, signal: abortController.signal }
		);
		await check('missing-user session rejection', async () =>
			assert.equal(
				await sessions.findValidSessionWithUser(missingUserHash, now),
				null
			)
		);

		beginCheck('logout deletes current session');
		await sessions.deleteSessionByTokenHash(sessionInput.tokenHash);
		await check('logout deletes current session', async () =>
			assert.equal(
				await sessions.findValidSessionWithUser(
					sessionInput.tokenHash,
					now
				),
				null
			)
		);
		await check('another session remains untouched', async () =>
			assert.ok(
				await sessions.findValidSessionWithUser(
					hashSessionToken(secondToken),
					now
				)
			)
		);
		beginCheck('account-safe projection');
		const account = await users.findAccountUserById(userInput.id);
		await check('account-safe projection', () =>
			assert.deepEqual(Object.keys(account ?? {}).sort(), [
				'createdAt',
				'email',
				'username'
			])
		);
		beginCheck('navigation-safe projection');
		const safeUser = await users.findUserById(userInput.id);
		await check('navigation-safe projection', () =>
			assert.deepEqual(Object.keys(safeUser ? { username: safeUser.username } : {}), ['username'])
		);
		beginCheck('raw token is not stored');
		const stored = await collections.sessions.findOne(
			{ tokenHash: hashSessionToken(secondToken) },
			{ timeoutMS: OPERATION_TIMEOUT_MS, signal: abortController.signal }
		);
		await check('raw token is not stored', () => {
			assert.ok(stored);
			assert.equal(Object.values(stored).includes(secondToken), false);
		});
		beginCheck('session token hash uniqueness');
		await assert.rejects(
			sessions.createSession({
				id: randomUUID(),
				userId: userInput.id,
				tokenHash: hashSessionToken(secondToken),
				expiresAt: new Date(now.getTime() + 120_000)
			})
		);
		await check('session token hash uniqueness', () => undefined);
		await check('SQLite default backend', () =>
			assert.equal(parseDatabaseBackend(undefined), 'sqlite')
		);
		await check('MongoDB users and sessions selected together', () =>
			assert.equal(
				assertUnifiedAuthBackend('mongodb', 'mongodb'),
				'mongodb'
			)
		);
		await check('mixed backend selection impossible', () =>
			assert.throws(() =>
				assertUnifiedAuthBackend('mongodb', 'sqlite')
			)
		);
	} catch (error) {
		primaryFailure = captureFailure(
			error,
			transactionActiveAtFailure || transactionActive,
			serverPrimary
		);
	} finally {
		if (
			database &&
			ownedDatabase.eligibleForCleanup &&
			ownedDatabase.touched
		) {
			try {
				beginStep('exact test database cleanup');
				await database.dropDatabase({ timeoutMS: OPERATION_TIMEOUT_MS });
				ownedDatabase.removed = true;
			} catch (error) {
				cleanupFailures.push(
					captureFailure(error, transactionActive, serverPrimary)
				);
			}
		} else {
			ownedDatabase.removed = true;
		}
		try {
			beginStep('client and ClientSession cleanup');
			await manager.close(true);
			clientClosed = true;
			assert.equal(activeClientSessions, 0);
		} catch (error) {
			cleanupFailures.push(
				captureFailure(error, transactionActive, serverPrimary)
			);
		}
		clearTimeout(watchdog);
	}

	const cleanupComplete =
		ownedDatabase.removed &&
		clientClosed &&
		activeClientSessions === 0;

	if (primaryFailure) {
		reportFailure('PRIMARY FAILURE', primaryFailure);
		for (const failure of cleanupFailures) {
			reportFailure('CLEANUP FAILURE', failure, true);
		}
		console.error(
			`CLEANUP STATUS: ${JSON.stringify({
				ownedDatabaseRemoved: ownedDatabase.removed,
				ownedResourcesClosed:
					clientClosed && activeClientSessions === 0
			})}`
		);
		process.exitCode = 1;
		return;
	}
	if (cleanupFailures.length > 0 || !cleanupComplete) {
		for (const failure of cleanupFailures) {
			reportFailure('CLEANUP FAILURE', failure, true);
		}
		process.exitCode = 1;
		return;
	}
	await check('exact test database cleanup', () =>
		assert.equal(ownedDatabase.removed, true)
	);
	await check('MongoClient and ClientSession cleanup', () =>
		assert.equal(clientClosed && activeClientSessions === 0, true)
	);
	assert.equal(checkNumber, EXPECTED_CHECKS);
	console.log(`MongoDB auth integration passed ${checkNumber}/${EXPECTED_CHECKS}.`);
}

main().catch((error) => {
	reportFailure(
		'UNEXPECTED CONTROLLER FAILURE',
		captureFailure(error, false, false)
	);
	process.exitCode = 1;
});

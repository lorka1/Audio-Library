import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import {
	MongoClientManager
} from '../src/lib/server/mongodb/client.ts';
import {
	assertMongoTestDatabaseName,
	readMongoConfig
} from '../src/lib/server/mongodb/config.ts';
import {
	getMongoCollections
} from '../src/lib/server/mongodb/collections.ts';
import {
	MONGODB_INDEX_DEFINITIONS
} from '../src/lib/server/mongodb/indexes.ts';
import {
	hashPassword,
	verifyPassword
} from '../src/lib/server/auth/password.ts';
import {
	assertUnifiedAuthBackend,
	parseDatabaseBackend,
} from '../src/lib/server/users/backend.ts';
import {
	createMongoUserRepository
} from '../src/lib/server/users/mongodb-repository.ts';
import {
	DuplicateUserError
} from '../src/lib/server/users/types.ts';

const TOTAL_TIMEOUT_MS = 90_000;
const OPERATION_TIMEOUT_MS = 5_000;
const TEST_DATABASE_MAX_LENGTH = 63;
const EXPECTED_CHECKS = 15;

let completedChecks = 0;
let activeStep = 'setup';

function relevantResourceCounts() {
	const counts = new Map();

	for (const resource of process.getActiveResourcesInfo()) {
		if (resource === 'Timeout' || resource.includes('TCP')) {
			counts.set(resource, (counts.get(resource) ?? 0) + 1);
		}
	}

	return counts;
}

async function waitForResourceRelease(initialResourceCounts) {
	const deadline = Date.now() + 2_000;

	while (Date.now() < deadline) {
		const activeResources = relevantResourceCounts();
		const released = [...activeResources].every(
			([resource, count]) =>
				count <= (initialResourceCounts.get(resource) ?? 0)
		);

		if (released) {
			return;
		}

		await new Promise((resolve) => setTimeout(resolve, 50));
	}

	throw new Error(
		'MongoDB M2 user integration left an owned resource active.'
	);
}

function check(label, assertion) {
	assertion();
	completedChecks += 1;
	console.log(`[check ${completedChecks}/${EXPECTED_CHECKS}] ${label}`);
}

function ownedTestDatabaseName(configuredName) {
	const suffix = `_m2_users_${randomBytes(6).toString('hex')}`;
	const base = configuredName.slice(
		0,
		TEST_DATABASE_MAX_LENGTH - suffix.length
	);
	const name = `${base}${suffix}`;

	assertMongoTestDatabaseName(name, process.env.MONGODB_DB_NAME ?? '');
	return name;
}

function safeFailureMessage(error) {
	if (
		error instanceof Error &&
		(error.message.startsWith('Missing required environment variable MONGODB_') ||
			error.message.startsWith('MONGODB_') ||
			error.message.startsWith('DATABASE_BACKEND'))
	) {
		return error.message;
	}

	const errorType = error instanceof Error ? error.name : 'UnknownError';
	const errorCode =
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(typeof error.code === 'string' || typeof error.code === 'number')
			? error.code
			: undefined;

	return `MongoDB M2 user integration failed during ${activeStep} (${errorType}${errorCode === undefined ? '' : `, code ${errorCode}`}).`;
}

async function main() {
	const initialResourceCounts = relevantResourceCounts();
	const config = readMongoConfig(process.env);
	assertMongoTestDatabaseName(
		config.testDatabaseName,
		config.databaseName
	);
	const databaseName = ownedTestDatabaseName(config.testDatabaseName);
	assert.notEqual(databaseName, config.databaseName);
	check('isolated test database selection', () => {
		assert.ok(databaseName.startsWith('audio_library_test_'));
		assert.notEqual(databaseName, config.databaseName);
	});

	const manager = new MongoClientManager({
		...config,
		testDatabaseName: databaseName
	});
	const abortController = new AbortController();
	const watchdog = setTimeout(() => {
		abortController.abort(
			new Error('MongoDB M2 user integration exceeded its total timeout.')
		);
	}, TOTAL_TIMEOUT_MS);
	watchdog.unref();

	let database;
	let primaryFailure;
	let cleanupFailure;
	let cleanupFailureStep;

	try {
		activeStep = 'connect isolated test database';
		const client = await manager.connect();
		database = client.db(databaseName);
		const collections = getMongoCollections(database);

		activeStep = 'ensure isolated user indexes';
		await collections.users.createIndexes(
			[...MONGODB_INDEX_DEFINITIONS.users],
			{ maxTimeMS: OPERATION_TIMEOUT_MS }
		);

		const repository = createMongoUserRepository(collections.users, {
			timeoutMS: OPERATION_TIMEOUT_MS,
			signal: abortController.signal
		});
		const password = 'Synthetic-M2-password-42';
		const passwordHash = await hashPassword(password);
		const input = {
			id: randomUUID(),
			username: 'm2_fixture_user',
			email: 'm2.fixture@example.test',
			passwordHash
		};

		activeStep = 'user repository assertions';
		const created = await repository.createUser(input);
		check('synthetic user creation', () => {
			assert.deepEqual(Object.keys(created).sort(), [
				'createdAt',
				'email',
				'id',
				'username'
			]);
			assert.equal(created.username, input.username);
		});

		const byId = await repository.findUserById(input.id);
		check('UUID lookup', () => {
			assert.equal(byId?.id, input.id);
		});

		const byUsername =
			await repository.findUserByNormalizedUsername(input.username);
		check('normalized username lookup', () => {
			assert.equal(byUsername?.username, input.username);
		});

		const wrongCaseUsername =
			await repository.findUserByNormalizedUsername(
				input.username.toUpperCase()
			);
		check('username case behavior preserved', () => {
			assert.equal(wrongCaseUsername, null);
		});

		const byEmail = await repository.findUserByNormalizedEmail(
			input.email
		);
		check('normalized email lookup', () => {
			assert.equal(byEmail?.email, input.email);
		});

		const conflicts = await repository.findRegistrationConflicts(
			input.username,
			input.email
		);
		check('registration conflict lookup', () => {
			assert.deepEqual(conflicts, {
				usernameTaken: true,
				emailTaken: true
			});
		});

		await assert.rejects(
			repository.createUser({
				...input,
				id: randomUUID(),
				email: 'm2.second@example.test'
			}),
			(error) =>
				error instanceof DuplicateUserError &&
				error.field === 'username'
		);
		check('duplicate username mapping', () => undefined);

		await assert.rejects(
			repository.createUser({
				...input,
				id: randomUUID(),
				username: 'm2_fixture_second'
			}),
			(error) =>
				error instanceof DuplicateUserError &&
				error.field === 'email'
		);
		check('duplicate email mapping', () => undefined);

		const account = await repository.findAccountUserById(input.id);
		check('account-safe projection', () => {
			assert.deepEqual(Object.keys(account ?? {}).sort(), [
				'createdAt',
				'email',
				'username'
			]);
		});

		const authentication =
			await repository.findAuthenticationUser(input.email);
		check('authentication-only projection', () => {
			assert.deepEqual(Object.keys(authentication ?? {}).sort(), [
				'id',
				'passwordHash'
			]);
		});

		assert.ok(authentication);
		assert.equal(
			await verifyPassword(password, authentication.passwordHash),
			true
		);
		check('valid password verification', () => undefined);
		assert.equal(
			await verifyPassword(
				'Synthetic-wrong-password-42',
				authentication.passwordHash
			),
			false
		);
		check('invalid password verification', () => undefined);

		check('SQLite backend default', () => {
			assert.equal(parseDatabaseBackend(undefined), 'sqlite');
		});
		check('unified MongoDB auth backend', () => {
			assert.equal(
				assertUnifiedAuthBackend('mongodb', 'mongodb'),
				'mongodb'
			);
			assert.throws(() =>
				assertUnifiedAuthBackend('mongodb', 'sqlite')
			);
		});

		assert.equal(completedChecks, EXPECTED_CHECKS);
	} catch (error) {
		primaryFailure = error;
	} finally {
		activeStep = 'isolated test database cleanup';
		const cleanupAbortController = new AbortController();
		const cleanupWatchdog = setTimeout(() => {
			cleanupAbortController.abort(
				new Error('MongoDB M2 user integration cleanup timed out.')
			);
		}, 10_000);
		cleanupWatchdog.unref();

		if (database) {
			try {
				activeStep = 'drop isolated test database';
				await database.dropDatabase({
					timeoutMS: OPERATION_TIMEOUT_MS,
					signal: cleanupAbortController.signal
				});
				activeStep = 'verify isolated test database removal';
				const collectionsAfterDrop = await database
					.listCollections(
						{},
						{
							nameOnly: true,
							timeoutMS: OPERATION_TIMEOUT_MS,
							signal: cleanupAbortController.signal
						}
					)
					.toArray();
				assert.equal(collectionsAfterDrop.length, 0);
			} catch (error) {
				cleanupFailure = error;
				cleanupFailureStep = activeStep;
			}
		}

		try {
			activeStep = 'close owned MongoDB client';
			await manager.close(true);
		} catch (error) {
			cleanupFailure ??= error;
			cleanupFailureStep ??= activeStep;
		}

		clearTimeout(cleanupWatchdog);
		clearTimeout(watchdog);
		try {
			activeStep = 'verify owned resource release';
			await waitForResourceRelease(initialResourceCounts);
		} catch (error) {
			cleanupFailure ??= error;
			cleanupFailureStep ??= activeStep;
		}
	}

	if (primaryFailure) {
		throw primaryFailure;
	}

	if (cleanupFailure) {
		activeStep = cleanupFailureStep ?? 'isolated test database cleanup';
		throw cleanupFailure;
	}

	activeStep = 'complete';
	console.log(
		`MongoDB M2 user integration passed ${completedChecks}/${EXPECTED_CHECKS}; isolated database removed and owned client closed.`
	);
}

main().catch((error) => {
	console.error(safeFailureMessage(error));
	process.exitCode = 1;
});

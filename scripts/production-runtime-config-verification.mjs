import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { MongoClientManager } from '../src/lib/server/mongodb/client.ts';
import {
	assertMongoTestDatabaseName,
	MONGODB_TEST_DATABASE_PREFIX,
	readMongoConfig
} from '../src/lib/server/mongodb/config.ts';
import { getMongoCollections } from '../src/lib/server/mongodb/collections.ts';
import { TRACK_PUBLIC_ID_COUNTER } from '../src/lib/server/mongodb/documents.ts';
import { ensureMongoIndexes } from '../src/lib/server/mongodb/indexes.ts';
import { safeMongoAggregateFingerprint } from './lib/mongodb-fingerprint.mjs';
import { createSyntheticApplicationEnvironment } from './lib/synthetic-app-environment.mjs';

const STARTUP_TIMEOUT_MS = 45_000;
const INVALID_EXIT_TIMEOUT_MS = 15_000;
const SHUTDOWN_TIMEOUT_MS = 15_000;
const OUTPUT_TAIL_LIMIT = 16 * 1024;
const TEMP_PREFIX = 'audio-library-runtime-config-';
const projectRoot = resolve('.');
const ownedChildren = new Set();

let activeStep = 'verification setup';

function beginStep(step) {
	activeStep = step;
}

function ownedDatabaseName(base, developmentName) {
	const suffix = `_runtime_${randomBytes(6).toString('hex')}`;
	const name = `${base.slice(0, 63 - suffix.length)}${suffix}`;
	assertMongoTestDatabaseName(name, developmentName);
	return name;
}

function isOwnedTemporaryRoot(path) {
	const resolved = resolve(path);
	return (
		dirname(resolved) === resolve(tmpdir()) &&
		basename(resolved).startsWith(TEMP_PREFIX)
	);
}

function errorContains(error, pattern) {
	if (error instanceof AggregateError) {
		return error.errors.some((nested) => errorContains(nested, pattern));
	}
	return error instanceof Error && pattern.test(error.message);
}

function safeFailure(error, step) {
	return {
		step,
		errorClass: error instanceof Error ? error.constructor.name : typeof error,
		...(errorContains(error, /BODY_SIZE_LIMIT/)
			? { category: 'upload-limit-validation' }
			: {}),
		...(typeof error === 'object' && error !== null && 'code' in error
			? { code: String(error.code) }
			: {}),
		...(typeof error === 'object' && error !== null && 'safeContext' in error
			? { context: error.safeContext }
			: {})
	};
}

function appendTail(current, chunk) {
	return `${current}${chunk.toString('utf8')}`.slice(-OUTPUT_TAIL_LIMIT);
}

async function waitBounded(promise, timeoutMs) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((resolveTimeout) => {
				timer = setTimeout(() => resolveTimeout(null), timeoutMs);
				timer.unref();
			})
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function runWithManager(manager, operation) {
	let result;
	let primaryError;
	try {
		result = await operation();
	} catch (error) {
		primaryError = error;
	}
	let cleanupError;
	try {
		await manager.close(true);
	} catch (error) {
		cleanupError = error;
	}
	if (primaryError && cleanupError) {
		throw new AggregateError(
			[primaryError, cleanupError],
			'MongoDB operation and owned-client cleanup both failed.'
		);
	}
	if (primaryError) throw primaryError;
	if (cleanupError) throw cleanupError;
	return result;
}

function launchNode(args, environment, { controlledShutdown = false } = {}) {
	let stdout = '';
	let stderr = '';
	const child = spawn(process.execPath, args, {
		cwd: projectRoot,
		env: environment,
		shell: false,
		stdio: controlledShutdown
			? ['ignore', 'pipe', 'pipe', 'ipc']
			: ['ignore', 'pipe', 'pipe'],
		windowsHide: true
	});
	child.stdout.on('data', (chunk) => {
		stdout = appendTail(stdout, chunk);
	});
	child.stderr.on('data', (chunk) => {
		stderr = appendTail(stderr, chunk);
	});
	const state = {
		child,
		closeOutcome: null,
		controlledShutdown,
		forcedTermination: false,
		shutdownRequestError: null,
		spawnError: null,
		output: () => ({ stdout, stderr })
	};
	state.closePromise = new Promise((resolveClose) => {
		child.once('close', (code, signal) => {
			state.closeOutcome = { code, signal };
			resolveClose(state.closeOutcome);
		});
	});
	child.once('error', (error) => {
		state.spawnError = error;
	});
	ownedChildren.add(state);
	return state;
}

async function reservePort() {
	return new Promise((resolvePort, rejectPort) => {
		const server = createServer();
		server.unref();
		server.once('error', rejectPort);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = typeof address === 'object' && address ? address.port : null;
			server.close((error) => {
				if (error) rejectPort(error);
				else if (port === null) rejectPort(new Error('Unable to reserve an owned port.'));
				else resolvePort(port);
			});
		});
	});
}

async function portIsReleased(port) {
	return new Promise((resolveReleased) => {
		const server = createServer();
		server.unref();
		server.once('error', () => resolveReleased(false));
		server.listen(port, '127.0.0.1', () => {
			server.close(() => resolveReleased(true));
		});
	});
}

async function waitForPortRelease(port) {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (await portIsReleased(port)) return true;
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
	}
	return false;
}

async function stopOwnedChild(state) {
	if (!state) return null;
	if (state.closeOutcome) return state.closeOutcome;
	if (state.child.exitCode === null && state.child.signalCode === null) {
		if (state.controlledShutdown && state.child.connected) {
			await new Promise((resolveRequest) => {
				state.child.send('shutdown', (error) => {
					state.shutdownRequestError = error ?? null;
					if (error && state.child.exitCode === null && state.child.signalCode === null) {
						state.child.kill();
					}
					resolveRequest();
				});
			});
		} else {
			state.child.kill();
		}
	}
	let outcome = await waitBounded(state.closePromise, SHUTDOWN_TIMEOUT_MS);
	if (!outcome) {
		state.forcedTermination = true;
		if (state.child.exitCode === null && state.child.signalCode === null) {
			state.child.kill('SIGKILL');
		}
		outcome = await waitBounded(state.closePromise, SHUTDOWN_TIMEOUT_MS);
	}
	assert.ok(outcome, 'Owned production process did not terminate after SIGKILL.');
	if (state.forcedTermination) {
		throw new Error('Owned production process required forced termination.');
	}
	return outcome;
}

function assertCleanShutdown(
	state,
	outcome,
	expectedLogCode = null,
	allowRequestedSignal = false
) {
	if (state.spawnError) throw new Error('Owned production process failed to spawn.');
	if (state.shutdownRequestError) {
		throw new Error('Owned production process rejected its shutdown request.');
	}
	if (state.forcedTermination) {
		throw new Error('Owned production process did not stop gracefully.');
	}
	const cleanExit = outcome.code === 0 && outcome.signal === null;
	const requestedSignalExit =
		allowRequestedSignal && outcome.code === null && outcome.signal === 'SIGTERM';
	if (!cleanExit && !requestedSignalExit) {
		throw Object.assign(new Error('Owned production process had an unexpected close outcome.'), {
			safeContext: { exitCode: outcome.code, signal: outcome.signal }
		});
	}
	if (expectedLogCode) {
		const output = state.output();
		assert.match(`${output.stdout}\n${output.stderr}`, new RegExp(expectedLogCode));
	}
}

async function runWithChildCleanup(
	state,
	operation,
	expectedLogCode = null,
	allowRequestedSignal = false
) {
	let primaryError;
	try {
		await operation();
	} catch (error) {
		primaryError = error;
	}
	let cleanupError;
	try {
		const outcome = await stopOwnedChild(state);
		assertCleanShutdown(state, outcome, expectedLogCode, allowRequestedSignal);
	} catch (error) {
		cleanupError = error;
	}
	if (primaryError && cleanupError) {
		throw new AggregateError(
			[primaryError, cleanupError],
			'Production probe and owned-process cleanup both failed.'
		);
	}
	if (primaryError) throw primaryError;
	if (cleanupError) throw cleanupError;
}

async function waitForLiveness(baseUrl, state) {
	const deadline = Date.now() + STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (state.child.exitCode !== null || state.child.signalCode !== null) {
			throw new Error('Owned production process exited before liveness succeeded.');
		}
		try {
			const response = await fetch(`${baseUrl}/api/health/live`, {
				signal: AbortSignal.timeout(1_500)
			});
			const payload = await response.json();
			if (response.status === 200 && payload.status === 'ok') return;
		} catch {
			// Retry until the bounded deadline.
		}
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
	}
	throw new Error('Owned production process did not become live in time.');
}

async function waitForReadyApplication(baseUrl, state) {
	const deadline = Date.now() + STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (state.child.exitCode !== null || state.child.signalCode !== null) {
			throw new Error('Owned production process exited before readiness succeeded.');
		}
		try {
			const live = await fetch(`${baseUrl}/api/health/live`, {
				signal: AbortSignal.timeout(1_500)
			});
			const ready = await fetch(`${baseUrl}/api/health/ready`, {
				signal: AbortSignal.timeout(6_000)
			});
			const application = await fetch(baseUrl, {
				signal: AbortSignal.timeout(6_000)
			});
			const livePayload = await live.json();
			const readyPayload = await ready.json();
			const applicationBody = await application.text();
			if (
				live.status === 200 &&
				livePayload.status === 'ok' &&
				ready.status === 200 &&
				readyPayload.status === 'ready' &&
				application.status === 200 &&
				applicationBody.length > 0
			) return;
		} catch {
			// Retry until the bounded deadline.
		}
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
	}
	throw new Error('Owned production process did not become ready in time.');
}

async function fileSnapshot(path) {
	if (!existsSync(path)) return null;
	const bytes = await readFile(path);
	return {
		byteSize: bytes.length,
		contentHash: createHash('sha256').update(bytes).digest('hex')
	};
}

async function directorySnapshot(root) {
	if (!existsSync(root)) return [];
	const files = [];
	async function visit(directory, prefix = '') {
		const entries = await readdir(directory, { withFileTypes: true });
		for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
			const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
			const absolutePath = join(directory, entry.name);
			if (entry.isDirectory()) await visit(absolutePath, relativePath);
			else if (entry.isFile()) {
				const [information, bytes] = await Promise.all([
					stat(absolutePath),
					readFile(absolutePath)
				]);
				files.push({
					path: relativePath,
					byteSize: information.size,
					contentHash: createHash('sha256').update(bytes).digest('hex')
				});
			} else {
				throw new Error('Private storage contains an unsupported filesystem entry.');
			}
		}
	}
	await visit(root);
	return files;
}

async function captureRealState(client, config) {
	const collections = getMongoCollections(client.db(config.databaseName));
	return {
		fingerprint: await safeMongoAggregateFingerprint(collections),
		counter: await collections.counters.findOne(
			{ _id: TRACK_PUBLIC_ID_COUNTER },
			{ projection: { _id: 0, value: 1 }, timeoutMS: 5_000 }
		)
	};
}

async function runInvalidLauncherProbe(environment) {
	const state = launchNode(
		['--experimental-strip-types', resolve('scripts/production-runtime-probe-child.mjs')],
		environment,
		{ controlledShutdown: true }
	);
	const outcome = await waitBounded(state.closePromise, INVALID_EXIT_TIMEOUT_MS);
	if (outcome === null) {
		const timeoutError = new Error(
			'Invalid production configuration did not terminate in time.'
		);
		try {
			await stopOwnedChild(state);
		} catch (cleanupError) {
			throw new AggregateError(
				[timeoutError, cleanupError],
				'Invalid-config timeout and owned-process cleanup both failed.'
			);
		}
		throw timeoutError;
	}
	assert.equal(state.spawnError, null);
	assert.notEqual(outcome.code, 0);
	const output = state.output();
	assert.match(`${output.stdout}\n${output.stderr}`, /BODY_SIZE_LIMIT/);
}

async function runInvalidBuiltReadinessProbe(environment, baseUrl) {
	const state = launchNode([resolve('build/index.js')], environment);
	await runWithChildCleanup(state, async () => {
		await waitForLiveness(baseUrl, state);
		const response = await fetch(`${baseUrl}/api/health/ready`, {
			signal: AbortSignal.timeout(8_000)
		});
		const payload = await response.json();
		assert.equal(response.status, 503);
		assert.deepEqual(payload, { status: 'unavailable' });
		assert.equal(state.child.exitCode, null);
		assert.equal(state.child.signalCode, null);
	}, null, true);
}

async function runValidProductionProbe(environment, baseUrl) {
	const state = launchNode(
		['--experimental-strip-types', resolve('scripts/production-runtime-probe-child.mjs')],
		environment,
		{ controlledShutdown: true }
	);
	await runWithChildCleanup(state, async () => {
		await waitForReadyApplication(baseUrl, state);
	}, 'shutdown_complete');
}

const config = readMongoConfig(process.env);
const ownedDatabase = ownedDatabaseName(config.testDatabaseName, config.databaseName);
const realAudioRoot = resolve(process.env.AUDIO_STORAGE_PATH?.trim() || 'storage/audio');
let initialTestDatabases;
let realBefore;
let localBefore;
let temporaryRoot;
let temporaryAudioRoot;
let temporaryCoverRoot;
let port;
let primaryFailure;
let ownedDatabaseAuthorizedForCleanup = false;
const cleanupFailures = [];

try {
	beginStep('record isolation baseline');
	const baselineManager = new MongoClientManager(config);
	await runWithManager(baselineManager, async () => {
		const client = await baselineManager.connect();
		const listed = await client.db('admin').admin().listDatabases({ nameOnly: true });
		initialTestDatabases = listed.databases
			.map(({ name }) => name)
			.filter((name) => name.startsWith(MONGODB_TEST_DATABASE_PREFIX))
			.sort();
		assert.equal(initialTestDatabases.includes(ownedDatabase), false);
		ownedDatabaseAuthorizedForCleanup = true;
		realBefore = await captureRealState(client, config);
	});
	localBefore = {
		audio: await directorySnapshot(realAudioRoot),
		environment: await fileSnapshot(resolve('.env'))
	};

	beginStep('prepare exact owned prerequisites');
	temporaryRoot = await mkdtemp(join(resolve(tmpdir()), TEMP_PREFIX));
	assert.ok(isOwnedTemporaryRoot(temporaryRoot));
	temporaryAudioRoot = join(temporaryRoot, 'audio');
	temporaryCoverRoot = join(temporaryAudioRoot, 'covers');
	await mkdir(temporaryCoverRoot, { recursive: true });
	const setupManager = new MongoClientManager({
		...config,
		databaseName: ownedDatabase
	});
	await runWithManager(setupManager, async () => {
		const client = await setupManager.connect();
		const collections = getMongoCollections(client.db(ownedDatabase));
		await ensureMongoIndexes(collections, { maxTimeMS: 5_000 });
		await collections.counters.updateOne(
			{ _id: TRACK_PUBLIC_ID_COUNTER },
			{ $setOnInsert: { value: 0 } },
			{ upsert: true }
		);
	});

	port = await reservePort();
	const baseUrl = `http://127.0.0.1:${port}`;
	const validEnvironment = createSyntheticApplicationEnvironment({
		AUDIO_STORAGE_PATH: temporaryAudioRoot,
		CI: '1',
		HOST: '127.0.0.1',
		MONGODB_URI: config.uri,
		MONGODB_DB_NAME: ownedDatabase,
		MONGODB_TEST_DB_NAME: config.testDatabaseName,
		NODE_ENV: 'production',
		NO_COLOR: '1',
		ORIGIN: `https://127.0.0.1:${port}`,
		PORT: String(port),
		SESSION_COOKIE_NAME: `runtime_${randomBytes(4).toString('hex')}`,
		SESSION_DURATION_DAYS: '7',
		SHUTDOWN_TIMEOUT: '10'
	});
	const invalidEnvironment = { ...validEnvironment, BODY_SIZE_LIMIT: '55M' };

	beginStep('reject invalid runtime configuration in production launcher');
	await runInvalidLauncherProbe(invalidEnvironment);
	assert.equal(await waitForPortRelease(port), true);

	beginStep('reject invalid runtime configuration in generated server');
	await runInvalidBuiltReadinessProbe(invalidEnvironment, baseUrl);
	assert.equal(await waitForPortRelease(port), true);

	beginStep('accept valid runtime configuration in production');
	await runValidProductionProbe(validEnvironment, baseUrl);
	assert.equal(await waitForPortRelease(port), true);
} catch (error) {
	primaryFailure = { error, step: activeStep };
} finally {
	beginStep('stop every owned production process');
	let ownedProcessesStopped = true;
	for (const state of ownedChildren) {
		try {
			await stopOwnedChild(state);
		} catch (error) {
			cleanupFailures.push({ error, step: activeStep });
		}
		if (!state.closeOutcome) ownedProcessesStopped = false;
	}
	if (!ownedProcessesStopped) {
		cleanupFailures.push({
			error: new Error('An owned production process remains active.'),
			step: activeStep
		});
	}

	beginStep('remove exact owned database and verify preservation');
	try {
		if (!ownedProcessesStopped) {
			throw new Error('Database cleanup skipped while an owned process remains active.');
		}
		if (!ownedDatabaseAuthorizedForCleanup) {
			throw new Error('Owned database cleanup was not authorized by the isolation baseline.');
		}
		const cleanupManager = new MongoClientManager(config);
		await runWithManager(cleanupManager, async () => {
			const client = await cleanupManager.connect();
			const listed = await client.db('admin').admin().listDatabases({ nameOnly: true });
			if (listed.databases.some(({ name }) => name === ownedDatabase)) {
				await client.db(ownedDatabase).dropDatabase({ timeoutMS: 10_000 });
			}
			const listedAfter = await client.db('admin').admin().listDatabases({ nameOnly: true });
			assert.deepEqual(
				listedAfter.databases
					.map(({ name }) => name)
					.filter((name) => name.startsWith(MONGODB_TEST_DATABASE_PREFIX))
					.sort(),
				initialTestDatabases
			);
			assert.deepEqual(await captureRealState(client, config), realBefore);
		});
	} catch (error) {
		cleanupFailures.push({ error, step: activeStep });
	}

	beginStep('remove exact owned storage root');
	if (temporaryRoot && existsSync(temporaryRoot)) {
		try {
			if (!ownedProcessesStopped) {
				throw new Error('Storage cleanup skipped while an owned process remains active.');
			}
			assert.ok(isOwnedTemporaryRoot(temporaryRoot));
			await rm(temporaryRoot, {
				recursive: true,
				force: true,
				maxRetries: 5,
				retryDelay: 200
			});
			assert.equal(existsSync(temporaryRoot), false);
		} catch (error) {
			cleanupFailures.push({ error, step: activeStep });
		}
	}

	beginStep('verify local state and port preservation');
	try {
		if (localBefore) {
			assert.deepEqual(
				{
					audio: await directorySnapshot(realAudioRoot),
					environment: await fileSnapshot(resolve('.env'))
				},
				localBefore
			);
		}
		if (port) assert.equal(await waitForPortRelease(port), true);
	} catch (error) {
		cleanupFailures.push({ error, step: activeStep });
	}
}

if (primaryFailure) {
	console.error(JSON.stringify({
		primaryFailure: safeFailure(primaryFailure.error, primaryFailure.step),
		cleanupFailures: cleanupFailures.map(({ error, step }) => safeFailure(error, step))
	}));
	process.exitCode = 1;
} else if (cleanupFailures.length > 0) {
	console.error(JSON.stringify({
		cleanupFailures: cleanupFailures.map(({ error, step }) => safeFailure(error, step))
	}));
	process.exitCode = 1;
} else {
	console.log('INVALID_55M_RUNTIME_REJECTED=1');
	console.log('INVALID_55M_GENERATED_READINESS_REJECTED=1');
	console.log('VALID_60M_RUNTIME_READY=1');
	console.log('PRODUCTION_RUNTIME_CONFIG_PROBES_PASSED=1');
	console.log('PASS: exact owned database, roots, processes, ports, clients, and timers cleaned.');
	console.log('PASS: real MongoDB, private audio/covers, .env, and older test databases are unchanged.');
}

import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
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
import { safeMongoAggregateFingerprint } from './lib/sqlite-mongodb-migration.mjs';

const EXPECTED_CHECKS = 23;
const STARTUP_TIMEOUT_MS = 45_000;
const REQUEST_TIMEOUT_MS = 12_000;
const SHUTDOWN_TIMEOUT_MS = 8_000;
const TEMP_PREFIX = 'audio-library-m7-cutover-';
const SYNTHETIC_AUDIO = new Uint8Array([
	0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x0f, 0x54, 0x49, 0x54, 0x32, 0x00, 0x00,
	0x00, 0x05, 0x00, 0x00, 0x4d, 0x37, 0x00, 0x01
]);

let checkNumber = 0;
let activeStep = 'controller setup';

function beginStep(label) {
	activeStep = label;
}

async function check(label, assertion) {
	beginStep(label);
	await assertion();
	checkNumber += 1;
	console.log(`PASS ${checkNumber}/${EXPECTED_CHECKS}: ${label}`);
}

function ownedDatabaseName(base, developmentName) {
	const suffix = `_m7_cutover_${randomBytes(6).toString('hex')}`;
	const name = `${base.slice(0, 63 - suffix.length)}${suffix}`;
	assertMongoTestDatabaseName(name, developmentName);
	return name;
}

function safeFailure(error, cleanup = false, step = activeStep) {
	const details = {
		category: cleanup ? 'cleanup failure' : 'integration failure',
		step,
		errorClass:
			error instanceof Error ? error.constructor.name : typeof error
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
		typeof error.safeContext === 'object'
	) {
		details.context = error.safeContext;
	}
	return details;
}

function safeStatusError(actualStatus, expectedStatus) {
	return Object.assign(new Error('Unexpected HTTP status.'), {
		safeContext: { actualStatus, expectedStatus }
	});
}

function safeServerLogCategory(stderr) {
	for (const category of [
		'MongoInvalidArgumentError',
		'MongoServerError',
		'MongoOperationTimeoutError',
		'Registration failed',
		'Vite startup failure'
	]) {
		if (stderr.includes(category)) return category;
	}
	return stderr.length > 0 ? 'unclassified stderr' : 'none';
}

function isOwnedTemporaryRoot(path) {
	const resolved = resolve(path);
	return (
		dirname(resolved) === resolve(tmpdir()) &&
		basename(resolved).startsWith(TEMP_PREFIX)
	);
}

async function reservePort() {
	return new Promise((resolvePort, reject) => {
		const server = createServer();
		server.unref();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port =
				typeof address === 'object' && address ? address.port : null;
			server.close((error) => {
				if (error) reject(error);
				else if (port === null) reject(new Error('Unable to reserve a test port.'));
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
	for (let attempt = 0; attempt < 40; attempt += 1) {
		if (await portIsReleased(port)) return true;
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
	}
	return false;
}

async function waitForStartup(baseUrl, child) {
	const deadline = Date.now() + STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			throw new Error('Owned Vite process exited before startup.');
		}
		try {
			const response = await fetch(`${baseUrl}/login`, {
				signal: AbortSignal.timeout(1_500)
			});
			await response.body?.cancel();
			if (response.status === 200) return;
		} catch {
			// The bounded startup loop retries until the deadline.
		}
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
	}
	throw new Error('Owned Vite process did not become ready in time.');
}

async function stopChild(child, closePromise) {
	if (!child || child.exitCode !== null) return true;
	child.kill();
	const result = await Promise.race([
		closePromise.then(() => true),
		new Promise((resolveTimeout) =>
			setTimeout(() => resolveTimeout(false), SHUTDOWN_TIMEOUT_MS)
		)
	]);
	if (!result && child.exitCode === null) {
		child.kill('SIGKILL');
		await Promise.race([
			closePromise,
			new Promise((resolveTimeout) =>
				setTimeout(resolveTimeout, SHUTDOWN_TIMEOUT_MS)
			)
		]);
	}
	return result || child.exitCode !== null || child.signalCode !== null;
}

async function request(baseUrl, path, options = {}) {
	return fetch(`${baseUrl}${path}`, {
		redirect: 'manual',
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		...options
	});
}

function formHeaders(baseUrl, cookie) {
	return {
		accept: 'text/html',
		origin: baseUrl,
		'content-type': 'application/x-www-form-urlencoded',
		...(cookie ? { cookie } : {})
	};
}

function cookieFrom(response, cookieName) {
	const setCookie = response.headers.get('set-cookie') ?? '';
	const match = new RegExp(`(?:^|,\\s*)${cookieName}=([^;]+)`).exec(setCookie);
	assert.ok(match, 'Expected session cookie was not set.');
	return `${cookieName}=${match[1]}`;
}

function form(values) {
	return new URLSearchParams(values);
}

async function directoryFileNames(root) {
	if (!existsSync(root)) return [];
	const entries = await readdir(root, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name)
		.sort();
}

async function main() {
	const config = readMongoConfig(process.env);
	const initialClientManager = new MongoClientManager(config);
	let manager;
	let client;
	let database;
	let collections;
	let child;
	let childClosePromise = Promise.resolve();
	let temporaryRoot;
	let temporaryAudioRoot;
	let testPort;
	let ownedName;
	let initialTestDatabases;
	let realFingerprintBefore;
	let realCounterBefore;
	let primaryFailure;
	let stderrTail = '';
	const cleanupFailures = [];
	const cleanup = {
		databaseRemoved: false,
		unknownDatabasesPreserved: false,
		temporaryRootRemoved: false,
		childStopped: false,
		portReleased: false,
		clientClosed: false
	};

	try {
		beginStep('isolation baseline');
		const initialClient = await initialClientManager.connect();
		const admin = initialClient.db('admin').admin();
		const listed = await admin.listDatabases({ nameOnly: true });
		initialTestDatabases = new Set(
			listed.databases
				.map(({ name }) => name)
				.filter((name) => name.startsWith(MONGODB_TEST_DATABASE_PREFIX))
		);
		const realCollections = getMongoCollections(
			initialClient.db(config.databaseName)
		);
		realFingerprintBefore =
			await safeMongoAggregateFingerprint(realCollections);
		realCounterBefore = await realCollections.counters.findOne(
			{ _id: TRACK_PUBLIC_ID_COUNTER },
			{ projection: { _id: 0, value: 1 }, timeoutMS: 5_000 }
		);
		await initialClientManager.close(true);

		ownedName = ownedDatabaseName(
			config.testDatabaseName,
			config.databaseName
		);
		assert.equal(initialTestDatabases.has(ownedName), false);

		temporaryRoot = await mkdtemp(join(resolve(tmpdir()), TEMP_PREFIX));
		assert.ok(isOwnedTemporaryRoot(temporaryRoot));
		temporaryAudioRoot = join(temporaryRoot, 'audio');
		await mkdir(temporaryAudioRoot);
		const temporarySqlite = join(temporaryRoot, 'unused.sqlite');

		manager = new MongoClientManager({
			...config,
			databaseName: ownedName,
			testDatabaseName: config.testDatabaseName
		});
		client = await manager.connect();
		database = client.db(ownedName);
		collections = getMongoCollections(database);
		await ensureMongoIndexes(collections, { maxTimeMS: 5_000 });

		testPort = await reservePort();
		const baseUrl = `http://127.0.0.1:${testPort}`;
		const cookieName = `m7_cutover_${randomBytes(4).toString('hex')}`;
		let stdoutBytes = 0;
		let stderrBytes = 0;
		child = spawn(
			process.execPath,
			[
				resolve('node_modules/vite/bin/vite.js'),
				'dev',
				'--host',
				'127.0.0.1',
				'--port',
				String(testPort),
				'--strictPort'
			],
			{
				cwd: resolve('.'),
				env: {
					...process.env,
					DATABASE_BACKEND: 'mongodb',
					DATABASE_URL: temporarySqlite,
					AUDIO_STORAGE_PATH: temporaryAudioRoot,
					SESSION_COOKIE_NAME: cookieName,
					MONGODB_DB_NAME: ownedName,
					MONGODB_TEST_DB_NAME: config.testDatabaseName
				},
				detached: false,
				shell: false,
				stdio: ['ignore', 'pipe', 'pipe'],
				windowsHide: true
			}
		);
		childClosePromise = new Promise((resolveClose) => {
			child.once('close', (code, signal) => resolveClose({ code, signal }));
		});
		child.stdout.on('data', (chunk) => {
			stdoutBytes += chunk.length;
		});
		child.stderr.on('data', (chunk) => {
			stderrBytes += chunk.length;
			stderrTail = `${stderrTail}${chunk.toString()}`.slice(-16 * 1024);
		});

		beginStep('isolated MongoDB application startup');
		await waitForStartup(baseUrl, child);
		await check('isolated MongoDB backend application starts', () => {
			assert.equal(child.exitCode, null);
			assert.ok(stdoutBytes >= 0);
			assert.equal(stderrBytes, 0);
		});

		const ownerPassword = 'M7-cutover-owner-password-42';
		const ownerEmail = `m7-owner-${randomBytes(4).toString('hex')}@example.test`;
		const ownerRegistration = await request(baseUrl, '/register', {
			method: 'POST',
			headers: formHeaders(baseUrl),
			body: form({
				username: `m7_owner_${randomBytes(4).toString('hex')}`,
				email: ownerEmail,
				password: ownerPassword,
				confirmPassword: ownerPassword
			})
		});
		const ownerRegistrationCookie = cookieFrom(ownerRegistration, cookieName);
		await check('registration redirects and sets a MongoDB session', () => {
			const finalPath = new URL(ownerRegistration.url).pathname;
			const location = ownerRegistration.headers.get('location');
			const redirectSucceeded =
				(ownerRegistration.status === 303 && location === '/') ||
				(ownerRegistration.status === 200 &&
					ownerRegistration.redirected &&
					finalPath === '/');
			if (!redirectSucceeded) {
				throw Object.assign(
					safeStatusError(ownerRegistration.status, 303),
					{
						safeContext: {
							actualStatus: ownerRegistration.status,
							expectedStatus: 303,
							redirected: ownerRegistration.redirected,
							finalPath,
							location
						}
					}
				);
			}
		});
		await ownerRegistration.body?.cancel();
		await check('registration commits user and session atomically', async () => {
			assert.equal(await collections.users.countDocuments({}), 1);
			assert.equal(await collections.sessions.countDocuments({}), 1);
		});

		const firstLogout = await request(baseUrl, '/logout', {
			method: 'POST',
			headers: { origin: baseUrl, cookie: ownerRegistrationCookie }
		});
		await check('registration session logs out cleanly', async () => {
			assert.equal(firstLogout.status, 303);
			assert.equal(await collections.sessions.countDocuments({}), 0);
		});
		await firstLogout.body?.cancel();

		const ownerLogin = await request(baseUrl, '/login', {
			method: 'POST',
			headers: formHeaders(baseUrl),
			body: form({
				email: ownerEmail,
				password: ownerPassword,
				redirectTo: '/'
			})
		});
		const ownerCookie = cookieFrom(ownerLogin, cookieName);
		await check('login creates a fresh MongoDB session', async () => {
			assert.equal(ownerLogin.status, 303);
			assert.equal(await collections.sessions.countDocuments({}), 1);
		});
		await ownerLogin.body?.cancel();

		const uploadForm = new FormData();
		uploadForm.set('title', 'M7 synthetic upload');
		uploadForm.set('artist', 'M7 synthetic artist');
		uploadForm.set('bpm', '128');
		uploadForm.set('musicalKey', 'C minor');
		uploadForm.set('genre', 'Electronic');
		uploadForm.set('description', 'Synthetic isolated cutover fixture.');
		uploadForm.set(
			'audioFile',
			new File([SYNTHETIC_AUDIO], 'm7-cutover.mp3', {
				type: 'audio/mpeg'
			})
		);
		const upload = await request(baseUrl, '/upload', {
			method: 'POST',
			headers: {
				accept: 'text/html',
				origin: baseUrl,
				cookie: ownerCookie
			},
			body: uploadForm
		});
		const uploadLocation = upload.headers.get('location') ?? '';
		const uploadMatch = /^\/tracks\/([1-9]\d*)\?uploaded=1$/.exec(
			uploadLocation
		);
		assert.ok(uploadMatch);
		const publicId = Number(uploadMatch[1]);
		await check('upload persists MongoDB metadata and temporary audio', async () => {
			assert.equal(upload.status, 303);
			assert.equal(await collections.tracks.countDocuments({}), 1);
			assert.equal((await directoryFileNames(temporaryAudioRoot)).length, 1);
		});
		await upload.body?.cancel();

		const browse = await request(baseUrl, '/tracks');
		const browseHtml = await browse.text();
		await check('Browse lists the isolated public upload', () => {
			assert.equal(browse.status, 200);
			assert.equal(
				(browseHtml.match(/<article class="track-card(?:\s|")/g) ?? [])
					.length,
				1
			);
		});

		const detail = await request(baseUrl, `/tracks/${publicId}`);
		await check('public detail resolves', () => assert.equal(detail.status, 200));
		await detail.body?.cancel();

		const fullStream = await request(
			baseUrl,
			`/api/tracks/${publicId}/stream`
		);
		const fullBytes = new Uint8Array(await fullStream.arrayBuffer());
		await check('stream returns the isolated audio bytes', () => {
			assert.equal(fullStream.status, 200);
			assert.deepEqual(fullBytes, SYNTHETIC_AUDIO);
		});

		const rangeStream = await request(
			baseUrl,
			`/api/tracks/${publicId}/stream`,
			{ headers: { range: 'bytes=0-3' } }
		);
		const rangeBytes = new Uint8Array(await rangeStream.arrayBuffer());
		await check('Range seeking preserves partial-content behavior', () => {
			assert.equal(rangeStream.status, 206);
			assert.deepEqual(rangeBytes, SYNTHETIC_AUDIO.slice(0, 4));
			assert.ok(rangeStream.headers.has('content-range'));
		});

		const download = await request(
			baseUrl,
			`/api/tracks/${publicId}/download`
		);
		const downloadBytes = new Uint8Array(await download.arrayBuffer());
		await check('download returns the isolated audio bytes', () => {
			assert.equal(download.status, 200);
			assert.deepEqual(downloadBytes, SYNTHETIC_AUDIO);
			assert.ok(download.headers.has('content-disposition'));
		});

		const myTracks = await request(baseUrl, '/my-tracks', {
			headers: { cookie: ownerCookie }
		});
		const myTracksHtml = await myTracks.text();
		await check('My Tracks resolves through MongoDB ownership', () => {
			assert.equal(myTracks.status, 200);
			assert.equal(
				(myTracksHtml.match(/<article class="owner-track-card(?:\s|")/g) ??
					[]).length,
				1
			);
		});

		const edit = await request(
			baseUrl,
			`/my-tracks/${publicId}/edit`,
			{
				method: 'POST',
				headers: formHeaders(baseUrl, ownerCookie),
				body: form({
					title: 'M7 synthetic upload updated',
					artist: 'M7 synthetic artist',
					bpm: '129',
					musicalKey: 'D minor',
					genre: 'Electronic',
					description: 'Synthetic isolated cutover fixture updated.'
				})
			}
		);
		await check('owner metadata edit persists without changing ownership', async () => {
			assert.equal(edit.status, 303);
			const track = await collections.tracks.findOne(
				{ publicId },
				{
					projection: {
						_id: 0,
						title: 1,
						bpm: 1,
						ownerId: 1
					}
				}
			);
			const owner = await collections.users.findOne(
				{ email: ownerEmail },
				{ projection: { _id: 1 } }
			);
			assert.equal(track?.title, 'M7 synthetic upload updated');
			assert.equal(track?.bpm, 129);
			assert.equal(track?.ownerId, owner?._id);
		});
		await edit.body?.cancel();

		const otherPassword = 'M7-cutover-other-password-42';
		const otherRegistration = await request(baseUrl, '/register', {
			method: 'POST',
			headers: formHeaders(baseUrl),
			body: form({
				username: `m7_other_${randomBytes(4).toString('hex')}`,
				email: `m7-other-${randomBytes(4).toString('hex')}@example.test`,
				password: otherPassword,
				confirmPassword: otherPassword
			})
		});
		const otherCookie = cookieFrom(otherRegistration, cookieName);
		await check('second isolated user registers independently', async () => {
			assert.equal(otherRegistration.status, 303);
			assert.equal(await collections.users.countDocuments({}), 2);
			assert.equal(await collections.sessions.countDocuments({}), 2);
		});
		await otherRegistration.body?.cancel();

		const forbiddenEdit = await request(
			baseUrl,
			`/my-tracks/${publicId}/edit`,
			{ headers: { cookie: otherCookie } }
		);
		await check('non-owner edit access returns safe 404', () =>
			assert.equal(forbiddenEdit.status, 404)
		);
		await forbiddenEdit.body?.cancel();

		const forbiddenDelete = await request(
			baseUrl,
			`/my-tracks/${publicId}/delete`,
			{
				method: 'POST',
				headers: formHeaders(baseUrl, otherCookie),
				body: form({})
			}
		);
		await check('non-owner delete cannot change the track', async () => {
			assert.equal(forbiddenDelete.status, 404);
			assert.equal(await collections.tracks.countDocuments({ publicId }), 1);
		});
		await forbiddenDelete.body?.cancel();

		const ownerDelete = await request(
			baseUrl,
			`/my-tracks/${publicId}/delete`,
			{
				method: 'POST',
				headers: formHeaders(baseUrl, ownerCookie),
				body: form({})
			}
		);
		await check('owner delete removes MongoDB metadata', async () => {
			assert.equal(ownerDelete.status, 303);
			assert.equal(await collections.tracks.countDocuments({ publicId }), 0);
		});
		await ownerDelete.body?.cancel();
		await check('owner delete removes audio and quarantine artifacts', async () => {
			assert.deepEqual(await directoryFileNames(temporaryAudioRoot), []);
		});

		const ownerLogout = await request(baseUrl, '/logout', {
			method: 'POST',
			headers: { origin: baseUrl, cookie: ownerCookie }
		});
		const otherLogout = await request(baseUrl, '/logout', {
			method: 'POST',
			headers: { origin: baseUrl, cookie: otherCookie }
		});
		await check('logout removes every isolated active session', async () => {
			assert.equal(ownerLogout.status, 303);
			assert.equal(otherLogout.status, 303);
			assert.equal(await collections.sessions.countDocuments({}), 0);
		});
		await ownerLogout.body?.cancel();
		await otherLogout.body?.cancel();

		const realCollectionsAfter = getMongoCollections(
			client.db(config.databaseName)
		);
		const realFingerprintAfter =
			await safeMongoAggregateFingerprint(realCollectionsAfter);
		const realCounterAfter = await realCollectionsAfter.counters.findOne(
			{ _id: TRACK_PUBLIC_ID_COUNTER },
			{ projection: { _id: 0, value: 1 }, timeoutMS: 5_000 }
		);
		await check('development MongoDB data and counter remain unchanged', () => {
			assert.equal(realFingerprintAfter, realFingerprintBefore);
			assert.deepEqual(realCounterAfter, realCounterBefore);
		});
	} catch (error) {
		primaryFailure = { error, step: activeStep };
	} finally {
		beginStep('owned application process cleanup');
		try {
			cleanup.childStopped = await stopChild(child, childClosePromise);
		} catch (error) {
			cleanupFailures.push({ error, step: activeStep });
		}

		beginStep('exact owned MongoDB database cleanup');
		try {
			if (database && ownedName) {
				await database.dropDatabase({ timeoutMS: 8_000 });
				const listedAfter = await client
					.db('admin')
					.admin()
					.listDatabases({ nameOnly: true });
				const afterNames = new Set(
					listedAfter.databases
						.map(({ name }) => name)
						.filter((name) =>
							name.startsWith(MONGODB_TEST_DATABASE_PREFIX)
						)
				);
				cleanup.databaseRemoved = !afterNames.has(ownedName);
				cleanup.unknownDatabasesPreserved =
					initialTestDatabases &&
					afterNames.size === initialTestDatabases.size &&
					[...initialTestDatabases].every((name) => afterNames.has(name));
			}
		} catch (error) {
			cleanupFailures.push({ error, step: activeStep });
		}

		beginStep('MongoClient cleanup');
		try {
			await manager?.close(true);
			await initialClientManager.close(true);
			cleanup.clientClosed = true;
		} catch (error) {
			cleanupFailures.push({ error, step: activeStep });
		}

		beginStep('owned temporary directory cleanup');
		try {
			if (temporaryRoot) {
				assert.ok(isOwnedTemporaryRoot(temporaryRoot));
				await rm(temporaryRoot, { recursive: true, force: true });
				cleanup.temporaryRootRemoved = !existsSync(temporaryRoot);
			}
		} catch (error) {
			cleanupFailures.push({ error, step: activeStep });
		}

		beginStep('owned test port cleanup');
		try {
			cleanup.portReleased =
				typeof testPort === 'number'
					? await waitForPortRelease(testPort)
					: true;
		} catch (error) {
			cleanupFailures.push({ error, step: activeStep });
		}
	}

	if (primaryFailure) {
		console.error(
			`PRIMARY FAILURE: ${JSON.stringify(
				safeFailure(primaryFailure.error, false, primaryFailure.step)
			)}`
		);
		console.error(
			`SERVER STATUS: ${JSON.stringify({
				stderrCategory: safeServerLogCategory(stderrTail)
			})}`
		);
	}
	for (const cleanupFailure of cleanupFailures) {
		console.error(
			`CLEANUP FAILURE: ${JSON.stringify(
				safeFailure(cleanupFailure.error, true, cleanupFailure.step)
			)}`
		);
	}
	if (primaryFailure || cleanupFailures.length > 0) {
		console.error(`CLEANUP STATUS: ${JSON.stringify(cleanup)}`);
		process.exitCode = 1;
		return;
	}

	await check('exact owned MongoDB database is removed', () => {
		assert.equal(cleanup.databaseRemoved, true);
		assert.equal(cleanup.unknownDatabasesPreserved, true);
	});
	await check('temporary audio and integration root are removed', () =>
		assert.equal(cleanup.temporaryRootRemoved, true)
	);
	await check('owned process, port, MongoClient, and sessions are closed', () => {
		assert.equal(cleanup.childStopped, true);
		assert.equal(cleanup.portReleased, true);
		assert.equal(cleanup.clientClosed, true);
	});
	assert.equal(checkNumber, EXPECTED_CHECKS);
	console.log(
		`MongoDB cutover integration passed ${checkNumber}/${EXPECTED_CHECKS}.`
	);
}

main().catch((error) => {
	console.error(
		`UNEXPECTED CONTROLLER FAILURE: ${JSON.stringify(safeFailure(error))}`
	);
	process.exitCode = 1;
});

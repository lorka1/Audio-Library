import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { finished } from 'node:stream/promises';
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

const EXPECTED_CHECKS = 39;
const STARTUP_TIMEOUT_MS = 45_000;
const REQUEST_TIMEOUT_MS = 12_000;
const SHUTDOWN_TIMEOUT_MS = 8_000;
const TEMP_PREFIX = 'audio-library-m7-cutover-';
const SYNTHETIC_AUDIO = new Uint8Array([
	0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x0f, 0x54, 0x49, 0x54, 0x32, 0x00, 0x00,
	0x00, 0x05, 0x00, 0x00, 0x4d, 0x37, 0x00, 0x01
]);
const SYNTHETIC_PNG = Uint8Array.from(
	Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
		'base64'
	)
);

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

function knownServerFailure(stderr) {
	if (
		stderr.includes(
			'BODY_SIZE_LIMIT must accommodate the maximum audio file, maximum cover image, and 1 MB of multipart overhead.'
		)
	) {
		return {
			category: 'operational configuration failure',
			setting: 'BODY_SIZE_LIMIT',
			requiredMinimumBytes: 56 * 1024 * 1024
		};
	}
	if (/replica set|replicaSet|writable PRIMARY|transaction topology/i.test(stderr)) {
		return { category: 'replica-set or PRIMARY failure' };
	}
	if (/MongoServerSelectionError|MongoOperationTimeoutError|ECONNREFUSED/i.test(stderr)) {
		return { category: 'MongoDB connection or server-selection failure' };
	}
	if (/EADDRINUSE/i.test(stderr)) return { category: 'port conflict' };
	return null;
}

function safeServerStatus(stdout, stderr, failure) {
	const knownFailure = knownServerFailure(stderr);
	if (knownFailure) return knownFailure;
	if (failure instanceof Error && failure.message.includes('did not become ready in time')) {
		return { category: 'startup timeout' };
	}
	if (failure instanceof Error && failure.message.includes('exited before startup')) {
		return { category: 'unexpected process exit' };
	}
	return {
		category: stderr.length > 0 ? 'unexpected startup stderr' : 'unexpected startup failure',
		stdoutCategory: stdout.length > 0 ? 'Vite emitted startup output' : 'none'
	};
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

async function waitForStartup(baseUrl, child, readServerFailure = () => null) {
	const deadline = Date.now() + STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const serverFailure = readServerFailure();
		if (serverFailure) {
			throw Object.assign(new Error('Owned Vite process reported a known startup failure.'), {
				safeContext: serverFailure
			});
		}
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

function trackUploadForm({
	title,
	audioFilename,
	coverImage
}) {
	const uploadForm = new FormData();
	uploadForm.set('title', title);
	uploadForm.set('artist', 'M7 synthetic artist');
	uploadForm.set('bpm', '128');
	uploadForm.set('musicalKey', 'C minor');
	uploadForm.set('genre', 'Electronic');
	uploadForm.set('description', 'Synthetic isolated cutover fixture.');
	uploadForm.set(
		'audioFile',
		new File([SYNTHETIC_AUDIO], audioFilename, {
			type: 'audio/mpeg'
		})
	);
	if (coverImage) uploadForm.set('coverImage', coverImage);
	return uploadForm;
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
	let serverLogStream;
	let serverLogPath;
	let temporaryRoot;
	let temporaryAudioRoot;
	let temporaryCoverRoot;
	let testPort;
	let ownedName;
	let initialTestDatabases;
	let realFingerprintBefore;
	let realCounterBefore;
	let primaryFailure;
	let stdoutTail = '';
	let stderrTail = '';
	let childUploadLimits;
	const cleanupFailures = [];
	const cleanup = {
		databaseRemoved: false,
		unknownDatabasesPreserved: false,
		temporaryRootRemoved: false,
		childStopped: false,
		portReleased: false,
		clientClosed: false,
		serverLogClosed: false,
		serverLogRemoved: false
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
		temporaryCoverRoot = join(temporaryAudioRoot, 'covers');
		serverLogPath = join(temporaryRoot, 'application.log');
		serverLogStream = createWriteStream(serverLogPath, {
			flags: 'wx',
			mode: 0o600
		});
		await mkdir(temporaryAudioRoot);
		manager = new MongoClientManager({
			...config,
			databaseName: ownedName,
			testDatabaseName: config.testDatabaseName
		});
		client = await manager.connect();
		database = client.db(ownedName);
		collections = getMongoCollections(database);
		await ensureMongoIndexes(collections, { maxTimeMS: 5_000 });
		await collections.counters.updateOne(
			{ _id: TRACK_PUBLIC_ID_COUNTER },
			{ $setOnInsert: { value: 0 } },
			{ upsert: true }
		);

		testPort = await reservePort();
		const baseUrl = `http://127.0.0.1:${testPort}`;
		const cookieName = `m7_cutover_${randomBytes(4).toString('hex')}`;
		let stdoutBytes = 0;
		let stderrBytes = 0;
		const childEnvironment = createSyntheticApplicationEnvironment({
			AUDIO_STORAGE_PATH: temporaryAudioRoot,
			SESSION_COOKIE_NAME: cookieName,
			MONGODB_URI: config.uri,
			MONGODB_DB_NAME: ownedName,
			MONGODB_TEST_DB_NAME: config.testDatabaseName
		});
		childUploadLimits = {
			MAX_AUDIO_FILE_SIZE_MB: childEnvironment.MAX_AUDIO_FILE_SIZE_MB ?? null,
			COVER_IMAGE_MAX_SIZE_MB: childEnvironment.COVER_IMAGE_MAX_SIZE_MB ?? null,
			BODY_SIZE_LIMIT: childEnvironment.BODY_SIZE_LIMIT ?? null
		};
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
				env: childEnvironment,
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
			stdoutTail = `${stdoutTail}${chunk.toString()}`.slice(-16 * 1024);
			serverLogStream.write(chunk);
		});
		child.stderr.on('data', (chunk) => {
			stderrBytes += chunk.length;
			stderrTail = `${stderrTail}${chunk.toString()}`.slice(-16 * 1024);
			serverLogStream.write(chunk);
		});

		beginStep('isolated MongoDB application startup');
		await waitForStartup(baseUrl, child, () => knownServerFailure(stderrTail));
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

		const uploadForm = trackUploadForm({
			title: 'M7 synthetic upload',
			audioFilename: 'm7-cutover.mp3',
			coverImage: new File([SYNTHETIC_PNG], 'm7-cover.png', {
				type: 'image/png'
			})
		});
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
		let storedCoverKey;
		await check('upload persists MongoDB metadata, audio, and private cover', async () => {
			assert.equal(upload.status, 303);
			assert.equal(await collections.tracks.countDocuments({}), 1);
			assert.equal((await directoryFileNames(temporaryAudioRoot)).length, 1);
			assert.equal((await directoryFileNames(temporaryCoverRoot)).length, 1);
			const document = await collections.tracks.findOne(
				{ publicId },
				{ projection: { _id: 0, coverImage: 1 } }
			);
			assert.equal(document?.coverImage?.mimeType, 'image/png');
			assert.equal(document?.coverImage?.byteSize, SYNTHETIC_PNG.byteLength);
			assert.match(
				document?.coverImage?.storageKey ?? '',
				/^[0-9a-f-]{36}\.png$/
			);
			storedCoverKey = document?.coverImage?.storageKey;
		});
		await upload.body?.cancel();

		const noCoverUpload = await request(baseUrl, '/upload', {
			method: 'POST',
			headers: {
				accept: 'text/html',
				origin: baseUrl,
				cookie: ownerCookie
			},
			body: trackUploadForm({
				title: 'M7 synthetic upload without cover',
				audioFilename: 'm7-cutover-no-cover.mp3'
			})
		});
		const noCoverLocation = noCoverUpload.headers.get('location') ?? '';
		const noCoverMatch = /^\/tracks\/([1-9]\d*)\?uploaded=1$/.exec(
			noCoverLocation
		);
		assert.ok(noCoverMatch);
		const noCoverPublicId = Number(noCoverMatch[1]);
		const missingCover = await request(
			baseUrl,
			`/api/tracks/${noCoverPublicId}/cover`
		);
		await check('HTTP upload without a cover remains compatible', async () => {
			assert.equal(noCoverUpload.status, 303);
			assert.equal(await collections.tracks.countDocuments({}), 2);
			assert.equal((await directoryFileNames(temporaryAudioRoot)).length, 2);
			assert.equal((await directoryFileNames(temporaryCoverRoot)).length, 1);
			assert.equal(
				(
					await collections.tracks.findOne(
						{ publicId: noCoverPublicId },
						{ projection: { _id: 0, coverImage: 1 } }
					)
				)?.coverImage,
				null
			);
			assert.equal(missingCover.status, 404);
		});
		await noCoverUpload.body?.cancel();
		await missingCover.body?.cancel();

		for (const invalidCover of [
			{
				label: 'SVG cover upload is rejected without orphan files',
				file: new File(
					['<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
					'forbidden.svg',
					{ type: 'image/svg+xml' }
				)
			},
			{
				label: 'invalid raster contents are rejected without orphan files',
				file: new File(['not-a-real-png'], 'forged.png', {
					type: 'image/png'
				})
			}
		]) {
			const rejectedUpload = await request(baseUrl, '/upload', {
				method: 'POST',
				headers: {
					accept: 'text/html',
					origin: baseUrl,
					cookie: ownerCookie
				},
				body: trackUploadForm({
					title: `Rejected ${invalidCover.label}`,
					audioFilename: 'must-not-remain.mp3',
					coverImage: invalidCover.file
				})
			});
			await check(invalidCover.label, async () => {
				assert.equal(rejectedUpload.status, 400);
				assert.equal(await collections.tracks.countDocuments({}), 2);
				assert.equal((await directoryFileNames(temporaryAudioRoot)).length, 2);
				assert.equal((await directoryFileNames(temporaryCoverRoot)).length, 1);
			});
			await rejectedUpload.body?.cancel();
		}

		const createPlaylist = await request(baseUrl, '/playlists?/create', {
			method: 'POST',
			headers: formHeaders(baseUrl, ownerCookie),
			body: form({
				name: 'M7 synthetic private playlist',
				description: ''
			})
		});
		const ownerDocument = await collections.users.findOne(
			{ email: ownerEmail },
			{ projection: { _id: 1 } }
		);
		const playlistDocument = await collections.playlists.findOne({
			ownerId: ownerDocument?._id,
			name: 'M7 synthetic private playlist'
		});
		assert.ok(playlistDocument);
		const playlistPublicId = playlistDocument.publicId;
		await check('owner creates a private playlist through POST and PRG', async () => {
			assert.equal(createPlaylist.status, 303);
			assert.equal(createPlaylist.headers.get('location'), '/playlists?created=1');
			assert.equal(typeof playlistPublicId, 'string');
			assert.equal(await collections.playlists.countDocuments({}), 1);
		});
		await createPlaylist.body?.cancel();

		const updatePlaylist = await request(
			baseUrl,
			`/playlists/${playlistPublicId}?/update`,
			{
				method: 'POST',
				headers: formHeaders(baseUrl, ownerCookie),
				body: form({
					name: 'M7 synthetic playlist renamed',
					description: 'Synthetic owner-only description.'
				})
			}
		);
		const playlistList = await request(baseUrl, '/playlists', {
			headers: { cookie: ownerCookie }
		});
		const playlistListHtml = await playlistList.text();
		const playlistDetail = await request(baseUrl, `/playlists/${playlistPublicId}`, {
			headers: { cookie: ownerCookie }
		});
		const playlistDetailHtml = await playlistDetail.text();
		await check('owner lists, views, renames, and edits a safe playlist projection', async () => {
			assert.equal(updatePlaylist.status, 303);
			assert.equal(playlistList.status, 200);
			assert.equal(playlistDetail.status, 200);
			assert.ok(playlistListHtml.includes('M7 synthetic playlist renamed'));
			assert.ok(playlistDetailHtml.includes('Synthetic owner-only description.'));
			for (const html of [playlistListHtml, playlistDetailHtml]) {
				assert.equal(html.includes(playlistDocument._id), false);
				assert.equal(html.includes(playlistDocument.ownerId), false);
			}
		});
		await updatePlaylist.body?.cancel();

		const addFirst = await request(baseUrl, `/tracks/${publicId}?/addToPlaylist`, {
			method: 'POST',
			headers: formHeaders(baseUrl, ownerCookie),
			body: form({ playlistPublicId, trackPublicId: String(publicId) })
		});
		const addDuplicate = await request(baseUrl, `/tracks/${publicId}?/addToPlaylist`, {
			method: 'POST',
			headers: formHeaders(baseUrl, ownerCookie),
			body: form({ playlistPublicId, trackPublicId: String(publicId) })
		});
		const addSecond = await request(baseUrl, `/tracks/${noCoverPublicId}?/addToPlaylist`, {
			method: 'POST',
			headers: formHeaders(baseUrl, ownerCookie),
			body: form({ playlistPublicId, trackPublicId: String(noCoverPublicId) })
		});
		const membershipCountAfterAdds = await collections.playlistItems.countDocuments({
			playlistId: playlistDocument._id
		});
		const addFirstLocation = addFirst.headers.get('location') ?? '';
		const addDuplicateLocation = addDuplicate.headers.get('location') ?? '';
		const addSecondLocation = addSecond.headers.get('location') ?? '';
		if (
			addFirst.status !== 303 ||
			addDuplicate.status !== 303 ||
			addSecond.status !== 303 ||
			!addFirstLocation.includes('playlistStatus=added') ||
			!addDuplicateLocation.includes('playlistStatus=already-added') ||
			!addSecondLocation.includes('playlistStatus=added') ||
			membershipCountAfterAdds !== 2
		) {
			throw Object.assign(new Error('Playlist HTTP add flow did not reach its safe state.'), {
				safeContext: {
					addFirstStatus: addFirst.status,
					addDuplicateStatus: addDuplicate.status,
					addSecondStatus: addSecond.status,
					addFirstLocation,
					addDuplicateLocation,
					addSecondLocation,
					membershipCountAfterAdds
				}
			});
		}
		await check('add-to-playlist is transactional and duplicate membership is idempotent', async () => {
			assert.equal(addFirst.status, 303);
			assert.match(addFirst.headers.get('location') ?? '', /playlistStatus=added/);
			assert.equal(addDuplicate.status, 303);
			assert.match(addDuplicate.headers.get('location') ?? '', /playlistStatus=already-added/);
			assert.equal(addSecond.status, 303);
			assert.equal(membershipCountAfterAdds, 2);
		});
		await addFirst.body?.cancel();
		await addDuplicate.body?.cancel();
		await addSecond.body?.cancel();

		const removeFirst = await request(
			baseUrl,
			`/playlists/${playlistPublicId}?/removeFromPlaylist`,
			{
				method: 'POST',
				headers: formHeaders(baseUrl, ownerCookie),
				body: form({ playlistPublicId, trackPublicId: String(publicId) })
			}
		);
		const readdFirst = await request(baseUrl, `/tracks/${publicId}?/addToPlaylist`, {
			method: 'POST',
			headers: formHeaders(baseUrl, ownerCookie),
			body: form({ playlistPublicId, trackPublicId: String(publicId) })
		});
		await check('playlist detail removes one exact membership without deleting the track', async () => {
			assert.equal(removeFirst.status, 303);
			assert.equal(readdFirst.status, 303);
			assert.equal(await collections.tracks.countDocuments({}), 2);
			assert.equal(await collections.playlistItems.countDocuments({ playlistId: playlistDocument._id }), 2);
		});
		await removeFirst.body?.cancel();
		await readdFirst.body?.cancel();

		const browse = await request(baseUrl, '/tracks');
		const browseHtml = await browse.text();
		await check('Browse lists the isolated public upload', () => {
			assert.equal(browse.status, 200);
			assert.equal(
				(browseHtml.match(/<article class="track-card(?:\s|")/g) ?? [])
					.length,
				2
			);
		});
		await check('logged-out Browse uses the real login flow for playlist actions', () => {
			assert.ok(browseHtml.includes('Log in to add to a playlist'));
			assert.equal(browseHtml.includes('M7 synthetic playlist renamed'), false);
		});

		const detail = await request(baseUrl, `/tracks/${publicId}`);
		const detailHtml = await detail.text();
		await check('public detail resolves', () => assert.equal(detail.status, 200));

		const publicCover = await request(
			baseUrl,
			`/api/tracks/${publicId}/cover`
		);
		const publicCoverBytes = new Uint8Array(await publicCover.arrayBuffer());
		await check('public cover returns bounded PNG bytes and safe headers', () => {
			assert.equal(typeof storedCoverKey, 'string');
			assert.equal(publicCover.status, 200);
			assert.equal(publicCover.headers.get('content-type'), 'image/png');
			assert.equal(
				publicCover.headers.get('content-length'),
				String(SYNTHETIC_PNG.byteLength)
			);
			assert.deepEqual(publicCoverBytes, SYNTHETIC_PNG);
			assert.equal(
				[...publicCover.headers.values()].join('\n').includes(storedCoverKey),
				false
			);
		});

		await collections.tracks.updateOne(
			{ publicId },
			{ $set: { visibility: 'private' } }
		);
		const anonymousPrivateCover = await request(
			baseUrl,
			`/api/tracks/${publicId}/cover`
		);
		const ownerPrivateCover = await request(
			baseUrl,
			`/api/tracks/${publicId}/cover`,
			{ headers: { cookie: ownerCookie } }
		);
		const ownerPrivateCoverBytes = new Uint8Array(
			await ownerPrivateCover.arrayBuffer()
		);
		await collections.tracks.updateOne(
			{ publicId },
			{ $set: { visibility: 'public' } }
		);
		await check('private cover is hidden publicly but available to its exact owner', () => {
			assert.equal(anonymousPrivateCover.status, 404);
			assert.equal(ownerPrivateCover.status, 200);
			assert.deepEqual(ownerPrivateCoverBytes, SYNTHETIC_PNG);
		});
		await anonymousPrivateCover.body?.cancel();

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
				2
			);
		});
		await check('authenticated add-to-playlist UI lists owned membership safely', () => {
			assert.ok(myTracksHtml.includes('M7 synthetic playlist renamed'));
			assert.ok(myTracksHtml.includes('?/removeFromPlaylist'));
			assert.equal(myTracksHtml.includes(playlistDocument._id), false);
			assert.equal(myTracksHtml.includes(playlistDocument.ownerId), false);
		});
		await check('browser HTML never exposes the private cover storage key', () => {
			assert.equal(typeof storedCoverKey, 'string');
			for (const html of [browseHtml, detailHtml, myTracksHtml]) {
				assert.equal(html.includes(storedCoverKey), false);
				assert.equal(html.includes(temporaryCoverRoot), false);
			}
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
						ownerId: 1,
						coverImage: 1
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
			assert.equal(track?.coverImage?.storageKey, storedCoverKey);
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

		const forbiddenPlaylist = await request(
			baseUrl,
			`/playlists/${playlistPublicId}`,
			{ headers: { cookie: otherCookie } }
		);
		const forbiddenPlaylistAdd = await request(
			baseUrl,
			`/tracks/${publicId}?/addToPlaylist`,
			{
				method: 'POST',
				headers: formHeaders(baseUrl, otherCookie),
				body: form({ playlistPublicId, trackPublicId: String(publicId) })
			}
		);
		await check('non-owner playlist view and membership mutation reveal no existence details', async () => {
			assert.equal(forbiddenPlaylist.status, 404);
			assert.equal(forbiddenPlaylistAdd.status, 303);
			assert.match(forbiddenPlaylistAdd.headers.get('location') ?? '', /playlistStatus=error/);
			assert.equal(await collections.playlistItems.countDocuments({ playlistId: playlistDocument._id }), 2);
		});
		await forbiddenPlaylist.body?.cancel();
		await forbiddenPlaylistAdd.body?.cancel();

		const forbiddenEdit = await request(
			baseUrl,
			`/my-tracks/${publicId}/edit`,
			{ headers: { cookie: otherCookie } }
		);
		await check('non-owner edit access returns safe 404', () =>
			assert.equal(forbiddenEdit.status, 404)
		);
		await forbiddenEdit.body?.cancel();

		await collections.tracks.updateOne(
			{ publicId },
			{ $set: { visibility: 'private' } }
		);
		const forbiddenPrivateCover = await request(
			baseUrl,
			`/api/tracks/${publicId}/cover`,
			{ headers: { cookie: otherCookie } }
		);
		await collections.tracks.updateOne(
			{ publicId },
			{ $set: { visibility: 'public' } }
		);
		const forbiddenPrivateCoverBody = await forbiddenPrivateCover.text();
		await check('private cover denies a different authenticated owner safely', () => {
			assert.equal(forbiddenPrivateCover.status, 404);
			assert.equal(forbiddenPrivateCoverBody.includes(storedCoverKey), false);
			assert.equal(forbiddenPrivateCoverBody.includes(temporaryCoverRoot), false);
		});

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
			assert.equal(await collections.tracks.countDocuments({}), 1);
			assert.equal(await collections.playlistItems.countDocuments({ playlistId: playlistDocument._id }), 1);
		});
		await ownerDelete.body?.cancel();

		const ownerNoCoverDelete = await request(
			baseUrl,
			`/my-tracks/${noCoverPublicId}/delete`,
			{
				method: 'POST',
				headers: formHeaders(baseUrl, ownerCookie),
				body: form({})
			}
		);
		await check('owner deletion also handles an upload without a cover', async () => {
			assert.equal(ownerNoCoverDelete.status, 303);
			assert.equal(
				await collections.tracks.countDocuments({ publicId: noCoverPublicId }),
				0
			);
			assert.equal(await collections.tracks.countDocuments({}), 0);
			assert.equal(await collections.playlistItems.countDocuments({ playlistId: playlistDocument._id }), 0);
		});
		await ownerNoCoverDelete.body?.cancel();
		await check('owner delete removes audio and quarantine artifacts', async () => {
			assert.deepEqual(await directoryFileNames(temporaryAudioRoot), []);
			assert.deepEqual(await directoryFileNames(temporaryCoverRoot), []);
		});

		const unconfirmedPlaylistDelete = await request(
			baseUrl,
			`/playlists/${playlistPublicId}?/delete`,
			{
				method: 'POST',
				headers: formHeaders(baseUrl, ownerCookie),
				body: form({})
			}
		);
		const confirmedPlaylistDelete = await request(
			baseUrl,
			`/playlists/${playlistPublicId}?/delete`,
			{
				method: 'POST',
				headers: formHeaders(baseUrl, ownerCookie),
				body: form({ confirmDelete: 'delete' })
			}
		);
		await check('playlist deletion requires confirmation and removes only its MongoDB documents', async () => {
			assert.equal(unconfirmedPlaylistDelete.status, 400);
			assert.equal(confirmedPlaylistDelete.status, 303);
			assert.equal(await collections.playlists.countDocuments({}), 0);
			assert.equal(await collections.playlistItems.countDocuments({}), 0);
		});
		await unconfirmedPlaylistDelete.body?.cancel();
		await confirmedPlaylistDelete.body?.cancel();

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

		beginStep('owned application log closure');
		try {
			if (serverLogStream) {
				serverLogStream.end();
				await finished(serverLogStream);
			}
			cleanup.serverLogClosed = true;
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
				cleanup.serverLogRemoved = serverLogPath ? !existsSync(serverLogPath) : true;
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
				...safeServerStatus(stdoutTail, stderrTail, primaryFailure.error),
				effectiveUploadLimits: {
					MAX_AUDIO_FILE_SIZE_MB: childUploadLimits?.MAX_AUDIO_FILE_SIZE_MB ?? 'missing',
					COVER_IMAGE_MAX_SIZE_MB:
						childUploadLimits?.COVER_IMAGE_MAX_SIZE_MB ?? 'missing; 5 MB default applies',
					BODY_SIZE_LIMIT: childUploadLimits?.BODY_SIZE_LIMIT ?? 'missing'
				}
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
		assert.deepEqual(
			{
				temporaryRootRemoved: cleanup.temporaryRootRemoved,
				serverLogClosed: cleanup.serverLogClosed,
				serverLogRemoved: cleanup.serverLogRemoved
			},
			{
				temporaryRootRemoved: true,
				serverLogClosed: true,
				serverLogRemoved: true
			}
		)
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

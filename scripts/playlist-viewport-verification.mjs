import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
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
import { hashSessionToken } from '../src/lib/server/auth/session-token.ts';
import { safeMongoAggregateFingerprint } from './lib/mongodb-fingerprint.mjs';

const VIEWPORTS = [
	[1920, 1080],
	[1440, 900],
	[1024, 768],
	[768, 1024],
	[390, 844]
];
const TEMP_PREFIX = 'audio-library-playlist-viewport-';
const STARTUP_TIMEOUT_MS = 45_000;

function browserBinary() {
	const candidates = [
		process.env.CHROME_BINARY?.trim(),
		'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
		'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
	].filter(Boolean);
	const binary = candidates.find((path) => existsSync(path));
	if (!binary) throw new Error('Chrome or Edge is required for playlist viewport verification.');
	return binary;
}

function ownedDatabaseName(base, developmentName) {
	const suffix = `_playlist_view_${randomBytes(6).toString('hex')}`;
	const name = `${base.slice(0, 63 - suffix.length)}${suffix}`;
	assertMongoTestDatabaseName(name, developmentName);
	return name;
}

function isOwnedTemporaryRoot(path) {
	const absolute = resolve(path);
	return dirname(absolute) === resolve(tmpdir()) && basename(absolute).startsWith(TEMP_PREFIX);
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
				else if (port === null) rejectPort(new Error('Unable to reserve a viewport-test port.'));
				else resolvePort(port);
			});
		});
	});
}

async function waitForApplication(baseUrl, child) {
	const deadline = Date.now() + STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error('Viewport-test application exited during startup.');
		try {
			const response = await fetch(`${baseUrl}/login`, { signal: AbortSignal.timeout(1_500) });
			await response.body?.cancel();
			if (response.status === 200) return;
		} catch {
			// Retry within the bounded startup window.
		}
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
	}
	throw new Error('Viewport-test application did not start in time.');
}

async function waitForBrowser(debugPort, child) {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error('Headless browser exited during startup.');
		try {
			const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`, {
				signal: AbortSignal.timeout(1_000)
			}).then((response) => response.json());
			const page = pages.find(({ type }) => type === 'page');
			if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
		} catch {
			// Retry within the bounded browser startup window.
		}
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
	}
	throw new Error('Headless browser debugging endpoint did not start in time.');
}

async function stopChild(child) {
	if (!child || child.exitCode !== null) return;
	const closed = new Promise((resolveClose) => child.once('close', resolveClose));
	child.kill();
	let timer;
	await Promise.race([
		closed,
		new Promise((resolveDelay) => {
			timer = setTimeout(resolveDelay, 5_000);
		})
	]);
	clearTimeout(timer);
	if (child.exitCode === null) {
		child.kill('SIGKILL');
		await Promise.race([
			closed,
			new Promise((resolveDelay) => {
				timer = setTimeout(resolveDelay, 5_000);
			})
		]);
		clearTimeout(timer);
	}
}

async function connectCdp(url) {
	const socket = new WebSocket(url);
	await new Promise((resolveOpen, rejectOpen) => {
		socket.addEventListener('open', resolveOpen, { once: true });
		socket.addEventListener('error', rejectOpen, { once: true });
	});
	let nextId = 0;
	const pending = new Map();
	let intentionalClose = false;
	socket.addEventListener('message', ({ data }) => {
		const message = JSON.parse(String(data));
		if (!message.id) return;
		const handler = pending.get(message.id);
		if (!handler) return;
		pending.delete(message.id);
		clearTimeout(handler.timer);
		if (message.error) handler.reject(new Error(message.error.message));
		else handler.resolve(message.result);
	});
	socket.addEventListener('close', () => {
		for (const handler of pending.values()) {
			clearTimeout(handler.timer);
			if (!intentionalClose) {
				handler.reject(new Error(`Browser debugging connection closed during ${handler.method}.`));
			}
		}
		pending.clear();
	});

	return {
		command(method, params = {}) {
			const id = ++nextId;
			return new Promise((resolveCommand, rejectCommand) => {
				const timer = setTimeout(() => {
					pending.delete(id);
					rejectCommand(new Error(`Browser command timed out: ${method}.`));
				}, 20_000);
				pending.set(id, { resolve: resolveCommand, reject: rejectCommand, timer, method });
				socket.send(JSON.stringify({ id, method, params }));
			});
		},
		close() {
			intentionalClose = true;
			socket.close();
		}
	};
}

async function evaluate(cdp, expression) {
	const result = await cdp.command('Runtime.evaluate', {
		expression,
		returnByValue: true,
		awaitPromise: true
	});
	if (result.exceptionDetails) {
		throw new Error(`Browser evaluation failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}.`);
	}
	return result.result.value;
}

async function navigate(cdp, url, selector) {
	await cdp.command('Page.navigate', { url });
	const deadline = Date.now() + 12_000;
	while (Date.now() < deadline) {
		const ready = await evaluate(
			cdp,
			`document.readyState === 'complete' && Boolean(document.querySelector(${JSON.stringify(selector)}))`
		);
		if (ready) return;
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
	}
	throw new Error('Browser page did not reach the expected playlist state.');
}

async function openPlaylistDialog(cdp) {
	const deadline = Date.now() + 8_000;
	while (Date.now() < deadline) {
		const open = await evaluate(cdp, `(async () => {
			if (document.querySelector('.playlist-dialog[open]')) return true;
			document.querySelector('.playlist-trigger')?.click();
			await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
			return Boolean(document.querySelector('.playlist-dialog[open]'));
		})()`);
		if (open) return;
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
	}
	throw new Error('Add-to-playlist dialog did not open after hydration.');
}

const config = readMongoConfig(process.env);
const databaseName = ownedDatabaseName(config.testDatabaseName, config.databaseName);
const manager = new MongoClientManager(config);
let initialTestDatabases;
let realFingerprint;
let realCounter;
let temporaryRoot;
let app;
let browser;
let browserDiagnostics = '';
let cdp;
let primaryFailure;
const cleanupFailures = [];

try {
	const client = await manager.connect();
	const listed = await client.db('admin').admin().listDatabases({ nameOnly: true });
	initialTestDatabases = listed.databases
		.map(({ name }) => name)
		.filter((name) => name.startsWith(MONGODB_TEST_DATABASE_PREFIX))
		.sort();
	assert.equal(initialTestDatabases.includes(databaseName), false);
	const realCollections = getMongoCollections(client.db(config.databaseName));
	realFingerprint = await safeMongoAggregateFingerprint(realCollections);
	realCounter = await realCollections.counters.findOne(
		{ _id: TRACK_PUBLIC_ID_COUNTER },
		{ projection: { _id: 0, value: 1 }, timeoutMS: 5_000 }
	);

	const collections = getMongoCollections(client.db(databaseName));
	await ensureMongoIndexes(collections, { maxTimeMS: 8_000 });
	await collections.counters.insertOne({ _id: TRACK_PUBLIC_ID_COUNTER, value: 2 });
	const now = new Date('2026-08-01T12:00:00.000Z');
	const ownerId = randomUUID();
	const token = randomBytes(32).toString('base64url');
	await collections.users.insertOne({
		_id: ownerId,
		username: 'synthetic_viewport_owner',
		email: 'synthetic-viewport@example.invalid',
		passwordHash: 'synthetic-only',
		createdAt: now,
		updatedAt: now
	});
	await collections.sessions.insertOne({
		_id: randomUUID(),
		tokenHash: hashSessionToken(token),
		userId: ownerId,
		expiresAt: new Date(Date.now() + 60 * 60_000),
		createdAt: now
	});
	const trackIds = [randomUUID(), randomUUID()];
	await collections.tracks.insertMany(trackIds.map((id, index) => ({
		_id: id,
		publicId: index + 1,
		ownerId,
		title: index === 0
			? 'Synthetic viewport track with a deliberately long but readable title'
			: 'Private viewport track',
		artist: 'Synthetic viewport artist',
		bpm: index === 0 ? 124 : null,
		musicalKey: null,
		genre: null,
		description: null,
		originalFilename: `synthetic-${index + 1}.mp3`,
		storageKey: `${randomUUID()}.mp3`,
		mimeType: 'audio/mpeg',
		fileSizeBytes: 64,
		durationMs: null,
		visibility: index === 0 ? 'public' : 'private',
		createdAt: now,
		updatedAt: now
	})));
	const playlistId = randomUUID();
	const playlistPublicId = randomBytes(18).toString('base64url');
	await collections.playlists.insertMany([
		{
			_id: playlistId,
			publicId: playlistPublicId,
			ownerId,
			name: 'L'.repeat(80),
			description: 'Synthetic responsive playlist description used only in an isolated browser check.',
			createdAt: now,
			updatedAt: now
		},
		{
			_id: randomUUID(),
			publicId: randomBytes(18).toString('base64url'),
			ownerId,
			name: 'Second synthetic playlist',
			description: null,
			createdAt: now,
			updatedAt: now
		}
	]);
	await collections.playlistItems.insertMany(trackIds.map((trackId, index) => ({
		_id: randomUUID(),
		playlistId,
		trackId,
		addedAt: new Date(now.getTime() + index)
	})));

	temporaryRoot = await mkdtemp(join(resolve(tmpdir()), TEMP_PREFIX));
	assert.ok(isOwnedTemporaryRoot(temporaryRoot));
	const audioRoot = join(temporaryRoot, 'audio');
	const browserProfile = join(temporaryRoot, 'browser-profile');
	await mkdir(audioRoot);
	const appPort = await reservePort();
	const debugPort = await reservePort();
	const baseUrl = `http://127.0.0.1:${appPort}`;
	const cookieName = `playlist_view_${randomBytes(4).toString('hex')}`;
	app = spawn(process.execPath, [
		resolve('node_modules/vite/bin/vite.js'),
		'dev',
		'--host',
		'127.0.0.1',
		'--port',
		String(appPort),
		'--strictPort'
	], {
		cwd: resolve('.'),
		env: {
			...process.env,
			AUDIO_STORAGE_PATH: audioRoot,
			SESSION_COOKIE_NAME: cookieName,
			MONGODB_DB_NAME: databaseName,
			MONGODB_TEST_DB_NAME: config.testDatabaseName
		},
		stdio: 'ignore',
		windowsHide: true
	});
	await waitForApplication(baseUrl, app);
	console.log('PLAYLIST_VIEWPORT_APP_READY=1');

	browser = spawn(browserBinary(), [
		'--headless=new',
		'--no-sandbox',
		'--disable-gpu',
		'--disable-gpu-sandbox',
		'--disable-extensions',
		'--disable-background-networking',
		'--no-first-run',
		'--no-default-browser-check',
		`--remote-debugging-port=${debugPort}`,
		`--user-data-dir=${browserProfile}`,
		'about:blank'
	], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
	browser.stderr?.setEncoding('utf8');
	browser.stderr?.on('data', (chunk) => {
		browserDiagnostics = `${browserDiagnostics}${chunk}`.slice(-4_000);
	});
	cdp = await connectCdp(await waitForBrowser(debugPort, browser));
	console.log('PLAYLIST_VIEWPORT_BROWSER_READY=1');
	await cdp.command('Page.enable');
	await cdp.command('Runtime.enable');
	await cdp.command('Network.enable');
	const cookie = await cdp.command('Network.setCookie', {
		name: cookieName,
		value: token,
		url: baseUrl,
		httpOnly: true,
		sameSite: 'Lax'
	});
	assert.equal(cookie.success, true);

	for (const [width, height] of VIEWPORTS) {
		await cdp.command('Emulation.setDeviceMetricsOverride', {
			width,
			height,
			deviceScaleFactor: 1,
			mobile: width <= 390
		});
		await navigate(cdp, `${baseUrl}/playlists`, '.playlist-card');
		const listState = await evaluate(cdp, `(() => {
			const cards = [...document.querySelectorAll('.playlist-card')];
			return {
				innerWidth: window.innerWidth,
				scrollWidth: document.documentElement.scrollWidth,
				cardCount: cards.length,
				cardOverflow: cards.some((card) => {
					const rect = card.getBoundingClientRect();
					return rect.left < -0.5 || rect.right > window.innerWidth + 0.5;
				}),
				playlistNavigation: [...document.querySelectorAll('a[href="/playlists"]')].length
			};
		})()`);
		assert.equal(listState.innerWidth, width);
		assert.ok(listState.scrollWidth <= width);
		assert.equal(listState.cardCount, 2);
		assert.equal(listState.cardOverflow, false);
		assert.ok(listState.playlistNavigation >= 2);

		await navigate(cdp, `${baseUrl}/playlists/${playlistPublicId}`, '.playlist-detail-page');
		const detailState = await evaluate(cdp, `(() => {
			const rows = [...document.querySelectorAll('.playlist-tracks li')];
			return {
				scrollWidth: document.documentElement.scrollWidth,
				rowCount: rows.length,
				rowOverflow: rows.some((row) => row.getBoundingClientRect().right > window.innerWidth + 0.5),
				bodyTextHasLongName: document.body.textContent.includes('${'L'.repeat(80)}')
			};
		})()`);
		assert.ok(detailState.scrollWidth <= width);
		assert.equal(detailState.rowCount, 2);
		assert.equal(detailState.rowOverflow, false);
		assert.equal(detailState.bodyTextHasLongName, true);

		await navigate(cdp, `${baseUrl}/my-tracks`, '.owner-track-grid');
		await openPlaylistDialog(cdp);
		const dialogState = await evaluate(cdp, `(() => {
			const dialog = document.querySelector('.playlist-dialog[open]');
			const rect = dialog.getBoundingClientRect();
			return {
				scrollWidth: document.documentElement.scrollWidth,
				dialogOpen: dialog.open,
				dialogContained: rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight,
				removeActions: [...dialog.querySelectorAll('button')].filter((button) => button.textContent.trim() === 'Remove').length
			};
		})()`);
		assert.ok(dialogState.scrollWidth <= width);
		assert.equal(dialogState.dialogOpen, true);
		assert.equal(dialogState.dialogContained, true);
		assert.equal(dialogState.removeActions, 1);
		const screenshot = await cdp.command('Page.captureScreenshot', {
			format: 'png',
			captureBeyondViewport: false
		});
		assert.ok(screenshot.data.length > 1_000);
		console.log(`PLAYLIST_VIEWPORT_PASS=${width}x${height}`);
	}

	console.log(`PLAYLIST_VIEWPORTS_VERIFIED=${VIEWPORTS.map(([width, height]) => `${width}x${height}`).join(',')}`);
} catch (error) {
	if (browser?.exitCode !== null || browserDiagnostics) {
		error.message = `${error.message} Browser exit code: ${browser?.exitCode ?? 'running'}.${browserDiagnostics ? ` Diagnostics: ${browserDiagnostics.trim()}` : ''}`;
	}
	primaryFailure = error;
} finally {
	try {
		cdp?.close();
		await stopChild(browser);
		await stopChild(app);
	} catch (error) {
		cleanupFailures.push(error);
	}
	try {
		const client = await manager.connect();
		const listed = await client.db('admin').admin().listDatabases({ nameOnly: true });
		if (listed.databases.some(({ name }) => name === databaseName)) {
			await client.db(databaseName).dropDatabase({ timeoutMS: 10_000 });
		}
		const after = (await client.db('admin').admin().listDatabases({ nameOnly: true }))
			.databases.map(({ name }) => name)
			.filter((name) => name.startsWith(MONGODB_TEST_DATABASE_PREFIX))
			.sort();
		assert.deepEqual(after, initialTestDatabases);
		const realCollections = getMongoCollections(client.db(config.databaseName));
		assert.equal(await safeMongoAggregateFingerprint(realCollections), realFingerprint);
		assert.deepEqual(
			await realCollections.counters.findOne(
				{ _id: TRACK_PUBLIC_ID_COUNTER },
				{ projection: { _id: 0, value: 1 }, timeoutMS: 5_000 }
			),
			realCounter
		);
	} catch (error) {
		cleanupFailures.push(error);
	}
	await manager.close(true).catch((error) => cleanupFailures.push(error));
	if (temporaryRoot && existsSync(temporaryRoot)) {
		try {
			assert.ok(isOwnedTemporaryRoot(temporaryRoot));
			await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
			assert.equal(existsSync(temporaryRoot), false);
		} catch (error) {
			cleanupFailures.push(error);
		}
	}
}

if (primaryFailure && cleanupFailures.length > 0) {
	throw new AggregateError([primaryFailure, ...cleanupFailures], 'Playlist viewport verification and cleanup failed.');
}
if (primaryFailure) throw primaryFailure;
if (cleanupFailures.length > 0) throw new AggregateError(cleanupFailures, 'Playlist viewport cleanup failed.');

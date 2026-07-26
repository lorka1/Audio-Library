import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, rmSync } from 'node:fs';
import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	stat,
	writeFile
} from 'node:fs/promises';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import {
	basename,
	dirname,
	isAbsolute,
	join,
	resolve
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnvironment } from 'dotenv';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATABASE_HELPER_PATH = resolve(PROJECT_ROOT, 'scripts/phase5-db-helper.mjs');
const TEMP_PREFIX = 'audio-library-phase5-integration-';
const STARTUP_TIMEOUT_MS = 60_000;
const OVERALL_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 8_000;
const LOG_TAIL_LIMIT = 64 * 1024;

loadEnvironment({ path: join(PROJECT_ROOT, '.env'), quiet: true });

let child;
let childExitPromise;
let temporaryRoot;
let testPort;
let stdoutPath;
let stderrPath;
let stdoutTail = '';
let stderrTail = '';
let startupComplete = false;
let realStateForCleanup;

const overallController = new AbortController();
const httpAgent = new HttpAgent({ keepAlive: false });

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function updateTail(current, chunk) {
	const updated = `${current}${chunk}`;
	return updated.length <= LOG_TAIL_LIMIT
		? updated
		: updated.slice(updated.length - LOG_TAIL_LIMIT);
}

function printServerLogs() {
	console.error('--- vite.out.log ---');
	console.error(stdoutTail || '<empty>');
	console.error('--- vite.err.log ---');
	console.error(stderrTail || '<empty>');
}

function resolveConfiguredPath(value, fallback) {
	const configured = value?.trim() || fallback;
	return isAbsolute(configured)
		? resolve(configured)
		: resolve(PROJECT_ROOT, configured);
}

function isSafeTemporaryRoot(path) {
	const resolvedParent = resolve(tmpdir());
	const resolvedPath = resolve(path);

	return (
		dirname(resolvedPath) === resolvedParent &&
		basename(resolvedPath).startsWith(TEMP_PREFIX)
	);
}

async function hashFile(path) {
	const contents = await readFile(path);
	return createHash('sha256').update(contents).digest('hex');
}

async function optionalFileSnapshot(path) {
	try {
		const fileStat = await stat(path);

		if (!fileStat.isFile()) {
			return null;
		}

		return {
			size: fileStat.size,
			hash: await hashFile(path)
		};
	} catch (error) {
		if (error && error.code === 'ENOENT') {
			return null;
		}

		throw error;
	}
}

async function directorySnapshot(root) {
	const snapshot = {};

	async function visit(directory, prefix = '') {
		let entries;

		try {
			entries = await readdir(directory, { withFileTypes: true });
		} catch (error) {
			if (error && error.code === 'ENOENT') {
				return;
			}

			throw error;
		}

		for (const entry of entries.sort((left, right) =>
			left.name.localeCompare(right.name)
		)) {
			const relativeName = prefix ? `${prefix}/${entry.name}` : entry.name;
			const absolutePath = join(directory, entry.name);

			if (entry.isDirectory()) {
				await visit(absolutePath, relativeName);
			} else if (entry.isFile()) {
				snapshot[relativeName] = await optionalFileSnapshot(absolutePath);
			}
		}
	}

	await visit(root);
	return snapshot;
}

async function realStateSnapshot(realDatabase, realAudioRoot) {
	return {
		database: await optionalFileSnapshot(realDatabase),
		databaseWal: await optionalFileSnapshot(`${realDatabase}-wal`),
		databaseShm: await optionalFileSnapshot(`${realDatabase}-shm`),
		audio: await directorySnapshot(realAudioRoot)
	};
}

function snapshotsEqual(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

async function copyDatabaseSnapshot(realDatabase, temporaryDatabase) {
	const before = await Promise.all([
		optionalFileSnapshot(realDatabase),
		optionalFileSnapshot(`${realDatabase}-wal`)
	]);

	assert(before[0] !== null, 'The real development database does not exist.');
	await copyFile(realDatabase, temporaryDatabase);

	if (before[1]) {
		await copyFile(`${realDatabase}-wal`, `${temporaryDatabase}-wal`);
	}

	const after = await Promise.all([
		optionalFileSnapshot(realDatabase),
		optionalFileSnapshot(`${realDatabase}-wal`)
	]);

	assert(
		snapshotsEqual(before, after),
		'The real database changed while its temporary snapshot was being copied.'
	);
}

async function reservePort() {
	return new Promise((resolvePort, reject) => {
		const server = createServer();

		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();

			if (!address || typeof address === 'string') {
				server.close();
				reject(new Error('Unable to reserve an isolated integration port.'));
				return;
			}

			const port = address.port;
			server.close((error) => {
				if (error) {
					reject(error);
				} else {
					resolvePort(port);
				}
			});
		});
	});
}

function delay(milliseconds) {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitForChildExit(milliseconds) {
	let timeout;

	try {
		return await Promise.race([
			childExitPromise.then(() => true),
			new Promise((resolveWait) => {
				timeout = setTimeout(() => resolveWait(false), milliseconds);
			})
		]);
	} finally {
		clearTimeout(timeout);
	}
}

function closeChildStream(stream, label) {
	if (!stream || stream.closed) {
		return Promise.resolve();
	}

	return new Promise((resolveClose, rejectClose) => {
		const timeout = setTimeout(() => {
			finish(new Error(`The Vite ${label} stream did not close.`));
		}, SHUTDOWN_TIMEOUT_MS);

		function finish(error) {
			clearTimeout(timeout);
			stream.removeListener('close', onClose);
			stream.removeListener('error', onError);

			if (error) {
				rejectClose(error);
			} else {
				resolveClose();
			}
		}

		function onClose() {
			finish();
		}

		function onError(error) {
			finish(error);
		}

		stream.once('close', onClose);
		stream.once('error', onError);
		stream.destroy();
	});
}

function normalizeHeaders(headers) {
	const normalized = new Map();

	for (const [name, value] of Object.entries(headers)) {
		normalized.set(
			name.toLowerCase(),
			Array.isArray(value) ? value.join(', ') : String(value ?? '')
		);
	}

	return {
		entries: () => normalized.entries(),
		get: (name) => normalized.get(name.toLowerCase()) ?? null
	};
}

async function request(baseUrl, path, options = {}) {
	const url = new URL(path, baseUrl);

	return new Promise((resolveResponse, reject) => {
		const chunks = [];
		let completed = false;
		let clientRequest;
		const timeout = setTimeout(() => {
			finish(new Error(`HTTP request to ${url.pathname} exceeded 10 seconds.`));
		}, REQUEST_TIMEOUT_MS);

		function finish(error, response) {
			if (completed) {
				return;
			}

			completed = true;
			clearTimeout(timeout);
			overallController.signal.removeEventListener('abort', onAbort);

			if (error) {
				reject(error);
			} else {
				resolveResponse(response);
			}
		}

		function onAbort() {
			clientRequest?.destroy(overallController.signal.reason);
			finish(overallController.signal.reason ?? new Error('HTTP request aborted.'));
		}

		const requestOptions = {
			agent: httpAgent,
			headers: {
				Connection: 'close',
				...(options.headers ?? {})
			},
			host: url.hostname,
			method: options.method ?? 'GET',
			path: `${url.pathname}${url.search}`,
			port: url.port,
			protocol: url.protocol
		};

		clientRequest = httpRequest(requestOptions, (clientResponse) => {
			clientResponse.on('data', (chunk) => chunks.push(chunk));
			clientResponse.once('error', (error) => finish(error));
			clientResponse.once('end', () => {
				const body = Buffer.concat(chunks);
				finish(null, {
					headers: normalizeHeaders(clientResponse.headers),
					status: clientResponse.statusCode ?? 0,
					arrayBuffer: async () =>
						body.buffer.slice(
							body.byteOffset,
							body.byteOffset + body.byteLength
						),
					text: async () => body.toString('utf8')
				});
			});
		});

		overallController.signal.addEventListener('abort', onAbort, { once: true });
		clientRequest.once('error', (error) => finish(error));
		clientRequest.end(options.body);
	});
}

async function waitForStartup(baseUrl) {
	const startedAt = Date.now();
	let lastProgressSecond = -1;

	while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
		if (overallController.signal.aborted) {
			throw overallController.signal.reason;
		}

		if (
			child &&
			(child.exitCode !== null || child.signalCode !== null)
		) {
			throw new Error(
				`Vite exited during startup (code ${child.exitCode}, signal ${child.signalCode}).`
			);
		}

		const elapsedSecond = Math.floor((Date.now() - startedAt) / 1000);

		if (elapsedSecond !== lastProgressSecond && elapsedSecond % 2 === 0) {
			console.log(
				`[startup] waiting for Vite on port ${testPort} (${elapsedSecond}s)`
			);
			lastProgressSecond = elapsedSecond;
		}

		try {
			const response = await request(baseUrl, '/tracks');

			if (response.status === 200) {
				await response.text();
				startupComplete = true;
				console.log(
					`[startup] Vite is ready after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
				);
				return;
			}
		} catch (error) {
			if (overallController.signal.aborted) {
				throw error;
			}
		}

		await delay(400);
	}

	throw new Error('Vite did not become ready within 60 seconds.');
}

async function canConnect(port) {
	return new Promise((resolveConnection) => {
		const socket = connect({ host: '127.0.0.1', port });
		let finished = false;

		const finish = (connected) => {
			if (finished) {
				return;
			}

			finished = true;
			socket.destroy();
			resolveConnection(connected);
		};

		socket.setTimeout(750, () => finish(false));
		socket.once('connect', () => finish(true));
		socket.once('error', () => finish(false));
	});
}

function isProcessAlive(pid) {
	if (!pid) {
		return false;
	}

	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function stopChildProcess() {
	if (
		!child?.pid ||
		child.exitCode !== null ||
		child.signalCode !== null
	) {
		return;
	}

	if (process.platform === 'win32') {
		spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
			stdio: 'ignore',
			timeout: SHUTDOWN_TIMEOUT_MS,
			windowsHide: true
		});
	} else {
		try {
			process.kill(-child.pid, 'SIGTERM');
		} catch {
			child.kill('SIGTERM');
		}
	}

	await waitForChildExit(SHUTDOWN_TIMEOUT_MS);

	if (child.exitCode === null && child.signalCode === null) {
		if (process.platform === 'win32') {
			spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
				stdio: 'ignore',
				timeout: SHUTDOWN_TIMEOUT_MS,
				windowsHide: true
			});
		} else {
			try {
				process.kill(-child.pid, 'SIGKILL');
			} catch {
				child.kill('SIGKILL');
			}
		}

		await waitForChildExit(SHUTDOWN_TIMEOUT_MS);
	}

	assert(
		child.exitCode !== null ||
			child.signalCode !== null ||
			!isProcessAlive(child.pid),
		`The integration Vite process ${child.pid} did not stop.`
	);
}

function recordHeaders(response) {
	return [...response.headers.entries()]
		.map(([name, value]) => `${name}: ${value}`)
		.join('\n');
}

function assertBytes(actual, expected, context) {
	assert(
		Buffer.from(actual).equals(Buffer.from(expected)),
		`${context} bytes did not match the expected file bytes.`
	);
}

function assertIncludesAll(text, expectedValues, context) {
	for (const expected of expectedValues) {
		assert(text.includes(expected), `${context} omitted "${expected}".`);
	}
}

function assertExcludesAll(text, excludedValues, context) {
	for (const excluded of excludedValues) {
		assert(!text.includes(excluded), `${context} unexpectedly included "${excluded}".`);
	}
}

function assertOrdered(text, values, context) {
	const positions = values.map((value) => text.indexOf(value));

	assert(
		positions.every((position) => position >= 0),
		`${context} did not contain every expected track.`
	);

	for (let index = 1; index < positions.length; index += 1) {
		assert(
			positions[index - 1] < positions[index],
			`${context} returned tracks in the wrong order.`
		);
	}
}

function queryPath(parameters) {
	const query = new URLSearchParams(parameters).toString();
	return query ? `/tracks?${query}` : '/tracks';
}

function readAttribute(tag, name) {
	const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const expression = new RegExp(
		`(?:^|\\s)${escapedName}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+)))?`,
		'i'
	);
	const match = expression.exec(tag);

	if (!match) {
		return null;
	}

	return match[1] ?? match[2] ?? match[3] ?? '';
}

function hasInputValue(html, name, value) {
	return [...html.matchAll(/<input\b[^>]*>/gi)].some(
		([tag]) => readAttribute(tag, 'name') === name && readAttribute(tag, 'value') === value
	);
}

function hasSelectedOption(html, selectName, value) {
	for (const match of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
		const [, attributes, contents] = match;

		if (readAttribute(attributes, 'name') !== selectName) {
			continue;
		}

		return [...contents.matchAll(/<option\b[^>]*>/gi)].some(
			([tag]) =>
				readAttribute(tag, 'value') === value &&
				readAttribute(tag, 'selected') !== null
		);
	}

	return false;
}

function hasResetLink(html) {
	return [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)].some(([anchor]) => {
		const openingTag = anchor.match(/^<a\b[^>]*>/i)?.[0] ?? '';
		const text = anchor.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
		return readAttribute(openingTag, 'href') === '/tracks' && text === 'Reset filters';
	});
}

function assertNoSecrets(text, secrets, context, secretKind = 'internal value') {
	for (const [secretIndex, secretValue] of secrets.entries()) {
		const secret = String(secretValue ?? '');

		if (!secret) {
			continue;
		}

		const variants = new Set([
			secret,
			secret.replaceAll('\\', '/'),
			encodeURIComponent(secret),
			encodeURI(secret)
		]);

		for (const [variantIndex, variant] of [...variants].entries()) {
			assert(
				!text.includes(variant),
				`${context} exposed ${secretKind} #${secretIndex + 1}, encoding #${variantIndex + 1}.`
			);
		}
	}
}

async function runDatabaseHelper(request) {
	const nonce = randomBytes(8).toString('hex');
	const requestPath = join(temporaryRoot, `database-helper-${nonce}.request.json`);
	const responsePath = join(temporaryRoot, `database-helper-${nonce}.response.json`);

	await writeFile(requestPath, JSON.stringify(request), { flag: 'wx' });

	try {
		const result = spawnSync(
			process.execPath,
			['--no-warnings', DATABASE_HELPER_PATH, requestPath, responsePath],
			{
				cwd: PROJECT_ROOT,
				encoding: 'utf8',
				shell: false,
				stdio: ['ignore', 'pipe', 'pipe'],
				timeout: 30_000,
				windowsHide: true
			}
		);

		assert(
			!result.error && result.status === 0,
			'The isolated temporary-database helper failed.'
		);

		return JSON.parse(await readFile(responsePath, 'utf8'));
	} finally {
		await Promise.all([
			rm(requestPath, { force: true }),
			rm(responsePath, { force: true })
		]);
	}
}

async function seedTemporaryData(temporaryDatabase, temporaryAudioRoot) {
	const token = `p5${Date.now()}${randomBytes(4).toString('hex')}`;
	const combinedMarker = `needle${randomBytes(4).toString('hex')}`;
	const artistMarker = `OrbitArtist${randomBytes(4).toString('hex')}`;
	const descriptionMarker = `velvet${randomBytes(4).toString('hex')}`;
	const caseText = `MiXeDCaSe${randomBytes(4).toString('hex')}`;
	const userId = randomUUID();
	const username = `phase5_${randomBytes(5).toString('hex')}`;
	const email = `phase5-${token}@example.test`;
	const nowSeconds = Math.floor(Date.now() / 1000);
	const firstCreatedAt = nowSeconds - 10_000;
	const publicBytes = Buffer.from(
		Array.from({ length: 96 }, (_, index) => (index * 11) % 256)
	);

	await mkdir(temporaryAudioRoot, { recursive: true });

	const definitions = [
		{
			key: 'alpha',
			title: `Alpha ${token} literal %_`,
			artist: 'River Artist',
			bpm: 90,
			musicalKey: 'C minor',
			genre: 'Techno',
			description: `Opening track in collection ${token}.`,
			visibility: 'public',
			createdAt: firstCreatedAt + 100
		},
		{
			key: 'bravo',
			title: `bravo ${token}`,
			artist: artistMarker,
			bpm: 128,
			musicalKey: 'A minor',
			genre: 'House',
			description: `Second track in collection ${token}.`,
			visibility: 'public',
			createdAt: firstCreatedAt + 200
		},
		{
			key: 'charlie',
			title: `CHARLIE ${token} ${caseText}`,
			artist: 'Third Artist',
			bpm: 140,
			musicalKey: 'D minor',
			genre: 'Jazz',
			description: `${descriptionMarker} in collection ${token}.`,
			visibility: 'public',
			createdAt: firstCreatedAt + 300
		},
		{
			key: 'delta',
			title: `delta ${token}`,
			artist: 'Null BPM Artist',
			bpm: null,
			musicalKey: 'E minor',
			genre: 'Ambient',
			description: `No BPM in collection ${token}.`,
			visibility: 'public',
			createdAt: firstCreatedAt + 400
		},
		{
			key: 'echo',
			title: `Echo ${token}`,
			artist: 'Combined Artist',
			bpm: 120,
			musicalKey: 'A minor',
			genre: 'House',
			description: `${combinedMarker} in collection ${token}.`,
			visibility: 'public',
			createdAt: firstCreatedAt + 500
		},
		{
			key: 'private',
			title: `Private ${token}`,
			artist: 'Hidden Artist',
			bpm: 120,
			musicalKey: 'A minor',
			genre: 'House',
			description: `${combinedMarker} hidden in collection ${token}.`,
			visibility: 'private',
			createdAt: firstCreatedAt + 600
		}
	];

	const tracksByKey = {};

	for (const definition of definitions) {
		const internalId = randomUUID();
		const storedFilename = `${randomUUID()}.mp3`;
		const originalFilename =
			definition.key === 'alpha'
				? 'Phase 5 result track.mp3'
				: `Phase 5 ${definition.key}.mp3`;

		tracksByKey[definition.key] = {
			...definition,
			internalId,
			storedFilename,
			originalFilename,
			mimeType: 'audio/mpeg',
			fileSizeBytes: publicBytes.length
		};
	}

	const databaseState = await runDatabaseHelper({
		action: 'seed',
		databasePath: temporaryDatabase,
		user: {
			id: userId,
			email,
			username,
			passwordHash: 'synthetic-phase5-integration-password-hash',
			createdAt: nowSeconds,
			updatedAt: nowSeconds
		},
		tracks: Object.values(tracksByKey)
	});
	assert(
		Array.isArray(databaseState.partyBefore) &&
			databaseState.partyBefore.length > 0 &&
			databaseState.partyBefore.every((track) => track.visibility === 'public'),
		'The copied database does not contain the required public "Party about you" track.'
	);

	await writeFile(
		join(temporaryAudioRoot, tracksByKey.alpha.storedFilename),
		publicBytes
	);

	const publicIdByInternalId = new Map(
		databaseState.publicIds.map((row) => [
			String(row.internalId),
			Number(row.publicId)
		])
	);

	for (const track of Object.values(tracksByKey)) {
		track.publicId = publicIdByInternalId.get(track.internalId);
		assert(
			Number.isSafeInteger(track.publicId) && track.publicId > 0,
			'A synthetic Phase 5 track did not receive a positive public ID.'
		);
	}

	return {
		token,
		combinedMarker,
		artistMarker,
		descriptionMarker,
		caseText,
		userId,
		email,
		publicBytes,
		partyBefore: databaseState.partyBefore,
		internalSecrets: databaseState.internalSecrets,
		tracks: tracksByKey
	};
}

async function runHttpChecks(baseUrl, seed, temporaryAudioRoot) {
	const responseArtifacts = [];
	const publicTracks = [
		seed.tracks.alpha,
		seed.tracks.bravo,
		seed.tracks.charlie,
		seed.tracks.delta,
		seed.tracks.echo
	];
	const publicTitles = publicTracks.map((track) => track.title);

	async function trackPage(parameters = {}) {
		const path = queryPath(parameters);
		const response = await request(baseUrl, path);
		const html = await response.text();
		responseArtifacts.push(path, recordHeaders(response), html);
		assert(response.status === 200, `GET ${path} returned ${response.status}.`);
		return html;
	}

	const defaultHtml = await trackPage();
	assertIncludesAll(defaultHtml, publicTitles, 'The default public track list');
	console.log('[check 1/26] /tracks returns every synthetic public track by default');

	const tokenHtml = await trackPage({ q: seed.token });
	assertIncludesAll(tokenHtml, publicTitles, 'The token-filtered public track list');
	assertExcludesAll(
		`${defaultHtml}\n${tokenHtml}`,
		[seed.tracks.private.title],
		'Public track results'
	);
	console.log('[check 2/26] matching private tracks never appear');

	const titleHtml = await trackPage({ q: `Alpha ${seed.token}` });
	assertIncludesAll(titleHtml, [seed.tracks.alpha.title], 'Title search');
	assertExcludesAll(
		titleHtml,
		publicTitles.filter((title) => title !== seed.tracks.alpha.title),
		'Title search'
	);
	console.log('[check 3/26] q matches a partial title');

	const artistHtml = await trackPage({ q: seed.artistMarker.toLowerCase() });
	assertIncludesAll(artistHtml, [seed.tracks.bravo.title], 'Artist search');
	assertExcludesAll(
		artistHtml,
		publicTitles.filter((title) => title !== seed.tracks.bravo.title),
		'Artist search'
	);
	console.log('[check 4/26] q matches an artist');

	const descriptionHtml = await trackPage({ q: seed.descriptionMarker });
	assertIncludesAll(
		descriptionHtml,
		[seed.tracks.charlie.title],
		'Description search'
	);
	assertExcludesAll(
		descriptionHtml,
		publicTitles.filter((title) => title !== seed.tracks.charlie.title),
		'Description search'
	);
	console.log('[check 5/26] q matches a description');

	const caseInsensitiveHtml = await trackPage({ q: seed.caseText.toLowerCase() });
	assertIncludesAll(
		caseInsensitiveHtml,
		[seed.tracks.charlie.title],
		'Case-insensitive search'
	);
	console.log('[check 6/26] q matching is case-insensitive');

	const literalWildcardHtml = await trackPage({ q: '%_' });
	assertIncludesAll(
		literalWildcardHtml,
		[seed.tracks.alpha.title],
		'Literal wildcard search'
	);
	assertExcludesAll(
		literalWildcardHtml,
		publicTitles.filter((title) => title !== seed.tracks.alpha.title),
		'Literal wildcard search'
	);
	console.log('[check 7/26] percent and underscore are searched literally');

	const minimumHtml = await trackPage({ q: seed.token, bpmMin: '125' });
	assertIncludesAll(
		minimumHtml,
		[seed.tracks.bravo.title, seed.tracks.charlie.title],
		'Minimum BPM filter'
	);
	assertExcludesAll(
		minimumHtml,
		[seed.tracks.alpha.title, seed.tracks.delta.title, seed.tracks.echo.title],
		'Minimum BPM filter'
	);
	console.log('[check 8/26] bpmMin is inclusive and excludes null BPM');

	const maximumHtml = await trackPage({ q: seed.token, bpmMax: '120' });
	assertIncludesAll(
		maximumHtml,
		[seed.tracks.alpha.title, seed.tracks.echo.title],
		'Maximum BPM filter'
	);
	assertExcludesAll(
		maximumHtml,
		[seed.tracks.bravo.title, seed.tracks.charlie.title, seed.tracks.delta.title],
		'Maximum BPM filter'
	);
	console.log('[check 9/26] bpmMax is inclusive and excludes null BPM');

	const rangeHtml = await trackPage({
		q: seed.token,
		bpmMin: '100',
		bpmMax: '130'
	});
	assertIncludesAll(
		rangeHtml,
		[seed.tracks.bravo.title, seed.tracks.echo.title],
		'BPM range filter'
	);
	assertExcludesAll(
		rangeHtml,
		[seed.tracks.alpha.title, seed.tracks.charlie.title, seed.tracks.delta.title],
		'BPM range filter'
	);
	console.log('[check 10/26] the inclusive BPM range works');

	const musicalKeyHtml = await trackPage({
		q: seed.token,
		musicalKey: 'A minor'
	});
	assertIncludesAll(
		musicalKeyHtml,
		[seed.tracks.bravo.title, seed.tracks.echo.title],
		'Musical-key filter'
	);
	assertExcludesAll(
		musicalKeyHtml,
		[seed.tracks.alpha.title, seed.tracks.charlie.title, seed.tracks.delta.title],
		'Musical-key filter'
	);
	console.log('[check 11/26] musicalKey uses an exact stored-value match');

	const genreHtml = await trackPage({ q: seed.token, genre: 'House' });
	assertIncludesAll(
		genreHtml,
		[seed.tracks.bravo.title, seed.tracks.echo.title],
		'Genre filter'
	);
	assertExcludesAll(
		genreHtml,
		[seed.tracks.alpha.title, seed.tracks.charlie.title, seed.tracks.delta.title],
		'Genre filter'
	);
	console.log('[check 12/26] genre uses an exact stored-value match');

	const combinedHtml = await trackPage({
		q: seed.combinedMarker,
		bpmMin: '100',
		bpmMax: '130',
		musicalKey: 'A minor',
		genre: 'House'
	});
	assertIncludesAll(combinedHtml, [seed.tracks.echo.title], 'Combined filters');
	assertExcludesAll(
		combinedHtml,
		[...publicTitles.filter((title) => title !== seed.tracks.echo.title), seed.tracks.private.title],
		'Combined filters'
	);
	console.log('[check 13/26] q, BPM, musical key, and genre combine with AND');

	const newestHtml = await trackPage({ q: seed.token, sort: 'newest' });
	assertOrdered(
		newestHtml,
		[
			seed.tracks.echo.title,
			seed.tracks.delta.title,
			seed.tracks.charlie.title,
			seed.tracks.bravo.title,
			seed.tracks.alpha.title
		],
		'Newest sorting'
	);
	console.log('[check 14/26] newest sorting is deterministic');

	const oldestHtml = await trackPage({ q: seed.token, sort: 'oldest' });
	assertOrdered(
		oldestHtml,
		[
			seed.tracks.alpha.title,
			seed.tracks.bravo.title,
			seed.tracks.charlie.title,
			seed.tracks.delta.title,
			seed.tracks.echo.title
		],
		'Oldest sorting'
	);
	console.log('[check 15/26] oldest sorting is deterministic');

	const titleSortHtml = await trackPage({ q: seed.token, sort: 'title_asc' });
	assertOrdered(
		titleSortHtml,
		[
			seed.tracks.alpha.title,
			seed.tracks.bravo.title,
			seed.tracks.charlie.title,
			seed.tracks.delta.title,
			seed.tracks.echo.title
		],
		'Title sorting'
	);
	console.log('[check 16/26] title_asc is case-insensitive and deterministic');

	const bpmAscendingHtml = await trackPage({ q: seed.token, sort: 'bpm_asc' });
	assertOrdered(
		bpmAscendingHtml,
		[
			seed.tracks.alpha.title,
			seed.tracks.echo.title,
			seed.tracks.bravo.title,
			seed.tracks.charlie.title,
			seed.tracks.delta.title
		],
		'Ascending BPM sorting'
	);
	console.log('[check 17/26] bpm_asc uses numeric order');

	const bpmDescendingHtml = await trackPage({ q: seed.token, sort: 'bpm_desc' });
	assertOrdered(
		bpmDescendingHtml,
		[
			seed.tracks.charlie.title,
			seed.tracks.bravo.title,
			seed.tracks.echo.title,
			seed.tracks.alpha.title,
			seed.tracks.delta.title
		],
		'Descending BPM sorting'
	);
	console.log('[check 18/26] bpm_desc uses numeric order');

	assert(
		bpmAscendingHtml.indexOf(seed.tracks.delta.title) >
			bpmAscendingHtml.indexOf(seed.tracks.charlie.title) &&
			bpmDescendingHtml.indexOf(seed.tracks.delta.title) >
				bpmDescendingHtml.indexOf(seed.tracks.alpha.title),
		'Null BPM was not placed after numeric BPM in both directions.'
	);
	console.log('[check 19/26] null BPM placement is deterministic and last');

	const invalidBpmHtml = await trackPage({ q: seed.token, bpmMin: '12.5' });
	assert(
		invalidBpmHtml.includes(
			'Minimum BPM must be an integer between 20 and 300.'
		),
		'Invalid minimum BPM did not render its validation message.'
	);
	assertExcludesAll(invalidBpmHtml, publicTitles, 'Invalid minimum BPM results');
	console.log('[check 20/26] invalid BPM renders validation instead of a 500');

	const invalidKeyHtml = await trackPage({
		q: seed.token,
		musicalKey: 'Definitely not a key'
	});
	assert(
		invalidKeyHtml.includes('The selected musical key is not valid.'),
		'Invalid musical key did not render its validation message.'
	);
	assertExcludesAll(invalidKeyHtml, publicTitles, 'Invalid musical-key results');
	console.log('[check 21/26] invalid musical key renders validation instead of a 500');

	const invalidRangeHtml = await trackPage({
		q: seed.token,
		bpmMin: '150',
		bpmMax: '100'
	});
	assert(
		invalidRangeHtml.includes(
			'Minimum BPM cannot be greater than maximum BPM.'
		),
		'An inverted BPM range did not render its validation message.'
	);
	assertExcludesAll(invalidRangeHtml, publicTitles, 'Invalid BPM-range results');
	console.log('[check 22/26] an inverted BPM range renders validation');

	const preservedValues = {
		q: seed.combinedMarker,
		bpmMin: '100',
		bpmMax: '130',
		musicalKey: 'A minor',
		genre: 'House',
		sort: 'bpm_desc'
	};
	const preservedHtml = await trackPage(preservedValues);
	assert(
		hasInputValue(preservedHtml, 'q', preservedValues.q) &&
			hasInputValue(preservedHtml, 'bpmMin', preservedValues.bpmMin) &&
			hasInputValue(preservedHtml, 'bpmMax', preservedValues.bpmMax) &&
			hasSelectedOption(
				preservedHtml,
				'musicalKey',
				preservedValues.musicalKey
			) &&
			hasSelectedOption(preservedHtml, 'genre', preservedValues.genre) &&
			hasSelectedOption(preservedHtml, 'sort', preservedValues.sort),
		'The rendered GET form did not preserve every submitted filter value.'
	);
	console.log('[check 23/26] submitted values remain visible in the rendered form');

	assert(hasResetLink(preservedHtml), 'The filter form did not provide a Reset filters link to /tracks.');
	console.log('[check 24/26] Reset filters links exactly to /tracks');

	const listDataResponse = await request(
		baseUrl,
		`/tracks/__data.json?${new URLSearchParams({ q: seed.token })}`
	);
	const listData = await listDataResponse.text();
	const detailResponse = await request(
		baseUrl,
		`/tracks/${seed.tracks.alpha.publicId}`
	);
	const detailHtml = await detailResponse.text();
	const detailDataResponse = await request(
		baseUrl,
		`/tracks/${seed.tracks.alpha.publicId}/__data.json`
	);
	const detailData = await detailDataResponse.text();
	responseArtifacts.push(
		recordHeaders(listDataResponse),
		listData,
		recordHeaders(detailResponse),
		detailHtml,
		recordHeaders(detailDataResponse),
		detailData
	);
	assert(
		listDataResponse.status === 200 &&
			detailResponse.status === 200 &&
			detailDataResponse.status === 200,
		'Public HTML or SvelteKit data requests did not all return 200.'
	);

	// Vite development responses may identify source modules. The privacy boundary
	// here is the database and audio storage, never the application source root.
	const physicalSecrets = [
		temporaryRoot,
		temporaryAudioRoot,
		resolveConfiguredPath(process.env.DATABASE_URL, 'data/app.db'),
		resolveConfiguredPath(process.env.AUDIO_STORAGE_PATH, 'storage/audio')
	];
	const publicResponses = responseArtifacts.join('\n');
	assertNoSecrets(
		publicResponses,
		seed.internalSecrets,
		'Public HTML, page data, or response headers',
		'an internal identifier'
	);
	assertNoSecrets(
		publicResponses,
		physicalSecrets,
		'Public HTML, page data, or response headers',
		'a filesystem path'
	);
	console.log('[check 25/26] responses expose no internal IDs, stored filenames, or paths');

	const fullStream = await request(
		baseUrl,
		`/api/tracks/${seed.tracks.alpha.publicId}/stream`
	);
	const fullStreamBytes = new Uint8Array(await fullStream.arrayBuffer());
	const partialStream = await request(
		baseUrl,
		`/api/tracks/${seed.tracks.alpha.publicId}/stream`,
		{ headers: { Range: 'bytes=0-9' } }
	);
	const partialStreamBytes = new Uint8Array(await partialStream.arrayBuffer());
	const download = await request(
		baseUrl,
		`/api/tracks/${seed.tracks.alpha.publicId}/download`
	);
	const downloadBytes = new Uint8Array(await download.arrayBuffer());
	const mediaHeaders = [
		recordHeaders(fullStream),
		recordHeaders(partialStream),
		recordHeaders(download)
	].join('\n');

	assert(
		fullStream.status === 200 &&
			fullStream.headers.get('accept-ranges') === 'bytes' &&
			fullStream.headers.get('content-length') === String(seed.publicBytes.length) &&
			fullStream.headers.get('x-content-type-options') === 'nosniff',
		'The full stream response was incomplete or insecure.'
	);
	assertBytes(fullStreamBytes, seed.publicBytes, 'Full stream');
	assert(
		partialStream.status === 206 &&
			partialStream.headers.get('content-range') ===
				`bytes 0-9/${seed.publicBytes.length}` &&
			partialStream.headers.get('content-length') === '10',
		'The partial stream response did not preserve Range behavior.'
	);
	assertBytes(partialStreamBytes, seed.publicBytes.subarray(0, 10), 'Partial stream');
	assert(
		download.status === 200 &&
			download.headers.get('content-length') === String(seed.publicBytes.length) &&
			download.headers.get('x-content-type-options') === 'nosniff' &&
			(download.headers.get('content-disposition') ?? '').startsWith('attachment;'),
		'The download response was incomplete or insecure.'
	);
	assertBytes(downloadBytes, seed.publicBytes, 'Download');
	assertNoSecrets(
		mediaHeaders,
		[
			seed.tracks.alpha.internalId,
			seed.tracks.alpha.storedFilename,
			temporaryRoot,
			temporaryAudioRoot
		],
		'Stream or download headers'
	);
	console.log('[check 26/26] result-track streaming, Range playback, and download still work');
}

async function runIntegration() {
	const realDatabase = resolveConfiguredPath(
		process.env.DATABASE_URL,
		'data/app.db'
	);
	const realAudioRoot = resolveConfiguredPath(
		process.env.AUDIO_STORAGE_PATH,
		'storage/audio'
	);
	const realStateBefore = await realStateSnapshot(realDatabase, realAudioRoot);
	realStateForCleanup = {
		realDatabase,
		realAudioRoot,
		realStateBefore
	};

	temporaryRoot = await mkdtemp(join(resolve(tmpdir()), TEMP_PREFIX));
	assert(
		isSafeTemporaryRoot(temporaryRoot),
		'The generated integration root is outside the validated temporary parent.'
	);

	const temporaryDatabase = join(temporaryRoot, 'app.db');
	const temporaryAudioRoot = join(temporaryRoot, 'audio');
	stdoutPath = join(temporaryRoot, 'vite.out.log');
	stderrPath = join(temporaryRoot, 'vite.err.log');
	await Promise.all([writeFile(stdoutPath, ''), writeFile(stderrPath, '')]);
	await copyDatabaseSnapshot(realDatabase, temporaryDatabase);

	const seed = await seedTemporaryData(temporaryDatabase, temporaryAudioRoot);
	testPort = await reservePort();
	const baseUrl = `http://127.0.0.1:${testPort}`;
	const cookieName = `phase5_integration_${randomBytes(4).toString('hex')}`;

	console.log(`[setup] isolated port: ${testPort}`);
	console.log('[setup] temporary database copy and audio storage are ready');

	child = spawn(
		process.execPath,
		[
			resolve(PROJECT_ROOT, 'node_modules/vite/bin/vite.js'),
			'dev',
			'--host',
			'127.0.0.1',
			'--port',
			String(testPort),
			'--strictPort'
		],
		{
			cwd: PROJECT_ROOT,
			env: {
				...process.env,
				DATABASE_URL: temporaryDatabase,
				AUDIO_STORAGE_PATH: temporaryAudioRoot,
				SESSION_COOKIE_NAME: cookieName
			},
			detached: true,
			shell: false,
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true
		}
	);
	childExitPromise = new Promise((resolveExit) => {
		child.once('exit', (code, signal) => resolveExit({ code, signal }));
	});
	child.stdout.on('data', (chunk) => {
		const text = chunk.toString();
		stdoutTail = updateTail(stdoutTail, text);
		appendFileSync(stdoutPath, text);
	});
	child.stderr.on('data', (chunk) => {
		const text = chunk.toString();
		stderrTail = updateTail(stderrTail, text);
		appendFileSync(stderrPath, text);
	});
	child.on('error', (error) => {
		const text = `[child process error] ${error.name}\n`;
		stderrTail = updateTail(stderrTail, text);
		appendFileSync(stderrPath, text);
	});

	await waitForStartup(baseUrl);
	await runHttpChecks(baseUrl, seed, temporaryAudioRoot);

	const verificationState = await runDatabaseHelper({
		action: 'capture-party',
		databasePath: temporaryDatabase
	});

	assert(
		snapshotsEqual(seed.partyBefore, verificationState.party),
		'The "Party about you" record changed in the temporary database copy.'
	);
	console.log('[isolation] "Party about you" remains present, public, and unchanged');

	const realStateDuring = await realStateSnapshot(realDatabase, realAudioRoot);
	assert(
		snapshotsEqual(realStateBefore, realStateDuring),
		'The real database or audio storage changed during isolated integration tests.'
	);
	console.log('[isolation] real database and storage/audio remained unchanged');
}

async function cleanup(realState) {
	const cleanupErrors = [];
	overallController.abort();

	function recordCleanupError(step, error) {
		cleanupErrors.push(error);
		console.error(
			`[cleanup] ${step} failed (${error instanceof Error ? error.name : 'UnknownError'}).`
		);
	}

	console.log('[cleanup] stopping the owned Vite process');
	try {
		await stopChildProcess();
	} catch (error) {
		recordCleanupError('owned Vite process stop', error);
	} finally {
		const streamResults = await Promise.allSettled([
			closeChildStream(child?.stdout, 'stdout'),
			closeChildStream(child?.stderr, 'stderr')
		]);

		for (const result of streamResults) {
			if (result.status === 'rejected') {
				recordCleanupError('Vite output stream close', result.reason);
			}
		}

		child?.unref();
	}
	console.log('[cleanup] owned Vite process stop completed');

	console.log('[cleanup] closing HTTP client connections');
	try {
		httpAgent.destroy();
	} catch (error) {
		recordCleanupError('HTTP client connection close', error);
	}
	console.log('[cleanup] HTTP client connection close completed');

	if (testPort) {
		console.log(`[cleanup] checking port ${testPort}`);
		try {
			assert(
				!(await canConnect(testPort)),
				`The integration port ${testPort} is still accepting connections.`
			);
		} catch (error) {
			recordCleanupError(`port ${testPort} postcondition`, error);
		}
		console.log(`[cleanup] port ${testPort} check completed`);
	}

	if (child?.pid) {
		console.log(`[cleanup] checking process ${child.pid}`);
		try {
			assert(
				!isProcessAlive(child.pid),
				`The integration Vite process ${child.pid} is still alive.`
			);
		} catch (error) {
			recordCleanupError(`process ${child.pid} postcondition`, error);
		}
		console.log(`[cleanup] process ${child.pid} check completed`);
	}

	if (realState) {
		console.log('[cleanup] checking real database and audio storage');
		try {
			const realStateAfter = await realStateSnapshot(
				realState.realDatabase,
				realState.realAudioRoot
			);
			assert(
				snapshotsEqual(realState.realStateBefore, realStateAfter),
				'The real database or audio storage changed during integration cleanup.'
			);
		} catch (error) {
			recordCleanupError('real-state postcondition', error);
		}
		console.log('[cleanup] real database and audio storage check completed');
	}

	if (temporaryRoot && existsSync(temporaryRoot)) {
		console.log('[cleanup] removing the validated temporary directory');
		try {
			assert(
				isSafeTemporaryRoot(temporaryRoot),
				'Refusing to remove an unvalidated temporary directory.'
			);
			rmSync(temporaryRoot, {
				recursive: true,
				force: true,
				maxRetries: 20,
				retryDelay: 250
			});
			assert(
				!existsSync(temporaryRoot),
				'The integration temporary directory was not removed.'
			);
		} catch (error) {
			recordCleanupError('temporary-directory postcondition', error);
		}
		console.log('[cleanup] temporary directory removal completed');
	}

	if (cleanupErrors.length > 0) {
		throw new AggregateError(cleanupErrors, 'Phase 5 integration cleanup failed.');
	}

	console.log('[cleanup] Vite stopped, port released, and temporary directory removed');
}

let primaryError;
let integrationPassed = false;
const overallTimer = setTimeout(() => {
	overallController.abort(
		new Error('The Phase 5 integration test exceeded its 120-second timeout.')
	);
}, OVERALL_TIMEOUT_MS);

try {
	await Promise.race([
		runIntegration(),
		new Promise((_, reject) => {
			overallController.signal.addEventListener(
				'abort',
				() => reject(overallController.signal.reason),
				{ once: true }
			);
		})
	]);
	integrationPassed = true;
} catch (error) {
	primaryError = error;
	console.error(
		`[failure] ${error instanceof Error ? error.message : String(error)}`
	);

	if (!startupComplete) {
		printServerLogs();
	}
} finally {
	clearTimeout(overallTimer);

	try {
		await cleanup(realStateForCleanup);
	} catch (cleanupError) {
		console.error(
			`[cleanup failure] ${
				cleanupError instanceof Error
					? cleanupError.message
					: String(cleanupError)
			}`
		);

		if (!primaryError) {
			primaryError = cleanupError;
		}
	}
}

if (primaryError) {
	process.exitCode = 1;
} else if (integrationPassed) {
	console.log('PHASE5_INTEGRATION_CHECKS_PASSED=26');
	process.exitCode = 0;
}

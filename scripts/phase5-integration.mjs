import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
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
const OVERALL_TIMEOUT_MS = 150_000;
const REQUEST_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 4_000;
const TEMP_REMOVE_TIMEOUT_MS = 8_000;
const LOG_TAIL_LIMIT = 64 * 1024;

loadEnvironment({ path: join(PROJECT_ROOT, '.env'), quiet: true });

let child;
let childClosePromise;
let temporaryRoot;
let testPort;
let stdoutPath;
let stderrPath;
let stdoutTail = '';
let stderrTail = '';
let startupComplete = false;
let realStateForCleanup;
let cleanupPromise;
let watchdogExpired = false;
let lastProgressStep = '[setup] controller initialization';
let failureProgressStep;
let databaseHelperProcess;
let databaseHelperClosePromise;

const overallController = new AbortController();
const httpAgent = new HttpAgent({ keepAlive: false });
const activeHttpRequests = new Set();
const activeHttpResponses = new Set();
const activeRequestControllers = new Set();
const activeTimers = new Set();

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

function logProgress(message) {
	lastProgressStep = message;
	console.log(message);
}

function safeDiagnostic(value) {
	let diagnostic = String(value ?? '');

	for (const path of [temporaryRoot, PROJECT_ROOT].filter(Boolean)) {
		diagnostic = diagnostic
			.replaceAll(path, '<redacted-path>')
			.replaceAll(path.replaceAll('\\', '/'), '<redacted-path>');
	}

	return diagnostic
		.replace(
			/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\.[a-z0-9]+)?\b/gi,
			'<redacted-internal-value>'
		)
		.replace(/\b[A-Za-z]:\\[^\r\n]*/g, '<redacted-path>')
		.replace(/\/(?:home|tmp|Users)\/[^\r\n]*/g, '<redacted-path>')
		.trim();
}

function printServerLogs() {
	console.error('--- Vite stdout (safe tail) ---');
	console.error(safeDiagnostic(stdoutTail) || '<empty>');
	console.error('--- Vite stderr (safe tail) ---');
	console.error(safeDiagnostic(stderrTail) || '<empty>');
}

function printActiveResources(context) {
	const resources = process
		.getActiveResourcesInfo()
		.map((resource) => String(resource))
		.sort();
	console.error(
		`[resources] ${context}: ${resources.length > 0 ? resources.join(', ') : '<none>'}`
	);
}

function trackedTimeout(callback, milliseconds) {
	const timer = setTimeout(() => {
		activeTimers.delete(timer);
		callback();
	}, milliseconds);
	activeTimers.add(timer);
	return timer;
}

function clearTrackedTimeout(timer) {
	if (timer) {
		clearTimeout(timer);
		activeTimers.delete(timer);
	}
}

function abortReason() {
	return overallController.signal.reason instanceof Error
		? overallController.signal.reason
		: new Error('Phase 5 integration was aborted.');
}

function throwIfAborted() {
	if (overallController.signal.aborted) {
		throw abortReason();
	}
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
	throwIfAborted();

	return new Promise((resolvePort, reject) => {
		const server = createServer();
		let completed = false;
		const timeout = trackedTimeout(() => {
			if (server.listening) {
				server.close();
			}
			finish(new Error('Isolated port reservation exceeded 5 seconds.'));
		}, 5_000);

		function finish(error, port) {
			if (completed) {
				return;
			}

			completed = true;
			clearTrackedTimeout(timeout);
			overallController.signal.removeEventListener('abort', onAbort);
			server.removeListener('error', onError);

			if (error) {
				reject(error);
			} else {
				resolvePort(port);
			}
		}

		function onAbort() {
			if (server.listening) {
				server.close();
			}
			finish(abortReason());
		}

		function onError(error) {
			finish(error);
		}

		server.once('error', onError);
		overallController.signal.addEventListener('abort', onAbort, { once: true });
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();

			if (!address || typeof address === 'string') {
				server.close();
				finish(new Error('Unable to reserve an isolated integration port.'));
				return;
			}

			const port = address.port;
			server.close((error) => {
				if (error) {
					finish(error);
				} else {
					finish(undefined, port);
				}
			});
		});

		if (overallController.signal.aborted) {
			onAbort();
		}
	});
}

function delay(milliseconds, { abortable = true } = {}) {
	return new Promise((resolveDelay, rejectDelay) => {
		let completed = false;
		const timer = trackedTimeout(() => finish(), milliseconds);

		function finish(error) {
			if (completed) {
				return;
			}

			completed = true;
			clearTrackedTimeout(timer);
			overallController.signal.removeEventListener('abort', onAbort);

			if (error) {
				rejectDelay(error);
			} else {
				resolveDelay();
			}
		}

		function onAbort() {
			finish(
				overallController.signal.reason ??
					new Error('Phase 5 integration was aborted.')
			);
		}

		if (abortable) {
			overallController.signal.addEventListener('abort', onAbort, {
				once: true
			});

			if (overallController.signal.aborted) {
				onAbort();
			}
		}
	});
}

async function waitForChildClose(milliseconds) {
	let timeout;

	try {
		return await Promise.race([
			childClosePromise.then(() => true),
			new Promise((resolveWait) => {
				timeout = trackedTimeout(() => resolveWait(false), milliseconds);
			})
		]);
	} finally {
		clearTrackedTimeout(timeout);
	}
}

function closeChildStream(stream, label) {
	if (!stream || stream.closed) {
		return Promise.resolve();
	}

	return new Promise((resolveClose, rejectClose) => {
		const timeout = trackedTimeout(() => {
			finish(new Error(`The Vite ${label} stream did not close.`));
		}, SHUTDOWN_TIMEOUT_MS);

		function finish(error) {
			clearTrackedTimeout(timeout);
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
	throwIfAborted();
	const url = new URL(path, baseUrl);

	return new Promise((resolveResponse, reject) => {
		const chunks = [];
		let completed = false;
		let clientRequest;
		let clientResponse;
		const requestController = new AbortController();
		activeRequestControllers.add(requestController);
		const timeout = trackedTimeout(() => {
			const error = new Error(
				`HTTP request to ${url.pathname} exceeded 10 seconds.`
			);
			requestController.abort(error);
			clientResponse?.destroy(error);
			clientRequest?.destroy(error);
			finish(error);
		}, REQUEST_TIMEOUT_MS);

		function finish(error, response) {
			if (completed) {
				return;
			}

			completed = true;
			clearTrackedTimeout(timeout);
			overallController.signal.removeEventListener('abort', onAbort);
			activeHttpRequests.delete(clientRequest);
			activeHttpResponses.delete(clientResponse);
			activeRequestControllers.delete(requestController);

			if (error) {
				reject(error);
			} else {
				resolveResponse(response);
			}
		}

		function onAbort() {
			const error =
				overallController.signal.reason ?? new Error('HTTP request aborted.');
			requestController.abort(error);
			clientResponse?.destroy(error);
			clientRequest?.destroy(error);
			finish(error);
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
			protocol: url.protocol,
			signal: requestController.signal
		};

		try {
			clientRequest = httpRequest(requestOptions, (incomingResponse) => {
				clientResponse = incomingResponse;
				activeHttpResponses.add(clientResponse);
				clientResponse.on('data', (chunk) => chunks.push(chunk));
				clientResponse.once('aborted', () =>
					finish(
						new Error(`HTTP response from ${url.pathname} was aborted.`)
					)
				);
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
		} catch (error) {
			finish(error);
			return;
		}

		activeHttpRequests.add(clientRequest);
		overallController.signal.addEventListener('abort', onAbort, { once: true });
		clientRequest.once('error', (error) => finish(error));
		clientRequest.end(options.body);
	});
}

function cancelActiveHttpOperations() {
	const error = new Error('Phase 5 cleanup cancelled an active HTTP operation.');

	for (const controller of activeRequestControllers) {
		controller.abort(error);
	}

	for (const response of activeHttpResponses) {
		response.destroy(error);
	}

	for (const request of activeHttpRequests) {
		request.destroy(error);
	}

	activeHttpResponses.clear();
	activeHttpRequests.clear();
	activeRequestControllers.clear();
	httpAgent.destroy();
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
			logProgress(
				`[startup] waiting for Vite (${elapsedSecond}s elapsed)`
			);
			lastProgressSecond = elapsedSecond;
		}

		try {
			const response = await request(baseUrl, '/tracks');

			if (response.status === 200) {
				await response.text();
				startupComplete = true;
				logProgress(
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

async function waitForPortRelease(port) {
	const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;

	do {
		if (!(await canConnect(port))) {
			return;
		}

		await delay(150, { abortable: false });
	} while (Date.now() < deadline);

	throw new Error('The Phase 5 integration port remained active after shutdown.');
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
	if (!child?.pid) {
		return;
	}

	if (isProcessAlive(child.pid)) {
		child.kill('SIGTERM');
	}

	child.stdout?.destroy();
	child.stderr?.destroy();
	let closed = await waitForChildClose(SHUTDOWN_TIMEOUT_MS);

	if (!closed || isProcessAlive(child.pid)) {
		child.kill('SIGKILL');
		child.stdout?.destroy();
		child.stderr?.destroy();
		closed = await waitForChildClose(SHUTDOWN_TIMEOUT_MS);
	}

	assert(
		closed && !isProcessAlive(child.pid),
		`The integration Vite process ${child.pid} did not stop.`
	);
}

async function stopDatabaseHelperProcess() {
	if (!databaseHelperProcess?.pid) {
		return;
	}

	if (isProcessAlive(databaseHelperProcess.pid)) {
		databaseHelperProcess.kill('SIGKILL');
	}

	databaseHelperProcess.stdout?.destroy();
	databaseHelperProcess.stderr?.destroy();
	let timeout;
	const closed = await Promise.race([
		databaseHelperClosePromise.then(() => true),
		new Promise((resolveWait) => {
			timeout = trackedTimeout(() => resolveWait(false), SHUTDOWN_TIMEOUT_MS);
		})
	]).finally(() => clearTrackedTimeout(timeout));

	assert(
		closed && !isProcessAlive(databaseHelperProcess.pid),
		'The owned database helper did not stop.'
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
	throwIfAborted();
	const nonce = randomBytes(8).toString('hex');
	const requestPath = join(temporaryRoot, `database-helper-${nonce}.request.json`);
	const responsePath = join(temporaryRoot, `database-helper-${nonce}.response.json`);

	await writeFile(requestPath, JSON.stringify(request), { flag: 'wx' });
	throwIfAborted();

	try {
		const helper = spawn(
			process.execPath,
			['--no-warnings', DATABASE_HELPER_PATH, requestPath, responsePath],
			{
				cwd: PROJECT_ROOT,
				shell: false,
				stdio: ['ignore', 'pipe', 'pipe'],
				windowsHide: true
			}
		);
		databaseHelperProcess = helper;
		databaseHelperClosePromise = new Promise((resolveClose) => {
			helper.once('close', (code, signal) => resolveClose({ code, signal }));
		});
		let helperError;
		let stderr = '';
		let stdout = '';
		let timeout;
		let forcedSettlementTimer;
		let onAbort;

		helper.stdout.on('data', (chunk) => {
			stdout = updateTail(stdout, chunk.toString());
		});
		helper.stderr.on('data', (chunk) => {
			stderr = updateTail(stderr, chunk.toString());
		});
		helper.once('error', (error) => {
			helperError = error;
		});

		const outcome = await new Promise((resolveOutcome, rejectOutcome) => {
			let settled = false;

			function finish(error, result) {
				if (settled) {
					return;
				}

				settled = true;
				clearTrackedTimeout(timeout);
				clearTrackedTimeout(forcedSettlementTimer);
				overallController.signal.removeEventListener('abort', onAbort);

				if (error) {
					rejectOutcome(error);
				} else {
					resolveOutcome(result);
				}
			}

			function interrupt(error) {
				helperError ??= error;
				helper.kill('SIGKILL');
				helper.stdout?.destroy();
				helper.stderr?.destroy();
				forcedSettlementTimer = trackedTimeout(
					() => finish(error),
					SHUTDOWN_TIMEOUT_MS
				);
			}

			onAbort = () => interrupt(abortReason());
			overallController.signal.addEventListener('abort', onAbort, {
				once: true
			});
			timeout = trackedTimeout(
				() =>
					interrupt(
						new Error('The isolated database helper exceeded 30 seconds.')
					),
				30_000
			);
			databaseHelperClosePromise.then((result) =>
				finish(helperError, result)
			);

			if (overallController.signal.aborted) {
				onAbort();
			}
		});

		assert(
			!helperError && outcome.code === 0,
			'The isolated temporary-database helper failed.'
		);
		databaseHelperProcess = undefined;
		databaseHelperClosePromise = undefined;

		return JSON.parse(await readFile(responsePath, 'utf8'));
	} finally {
		if (
			!databaseHelperProcess?.pid ||
			!isProcessAlive(databaseHelperProcess.pid)
		) {
			await Promise.all([
				rm(requestPath, { force: true }),
				rm(responsePath, { force: true })
			]);
		}
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
		databaseState.databaseStateBefore &&
			Array.isArray(databaseState.databaseStateBefore.users) &&
			Array.isArray(databaseState.databaseStateBefore.sessions) &&
			Array.isArray(databaseState.databaseStateBefore.tracks),
		'The copied database baseline could not be captured.'
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
		databaseStateBefore: databaseState.databaseStateBefore,
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
	logProgress('[check 1/26] /tracks returns every synthetic public track by default');

	const tokenHtml = await trackPage({ q: seed.token });
	assertIncludesAll(tokenHtml, publicTitles, 'The token-filtered public track list');
	assertExcludesAll(
		`${defaultHtml}\n${tokenHtml}`,
		[seed.tracks.private.title],
		'Public track results'
	);
	logProgress('[check 2/26] matching private tracks never appear');

	const titleHtml = await trackPage({ q: `Alpha ${seed.token}` });
	assertIncludesAll(titleHtml, [seed.tracks.alpha.title], 'Title search');
	assertExcludesAll(
		titleHtml,
		publicTitles.filter((title) => title !== seed.tracks.alpha.title),
		'Title search'
	);
	logProgress('[check 3/26] q matches a partial title');

	const artistHtml = await trackPage({ q: seed.artistMarker.toLowerCase() });
	assertIncludesAll(artistHtml, [seed.tracks.bravo.title], 'Artist search');
	assertExcludesAll(
		artistHtml,
		publicTitles.filter((title) => title !== seed.tracks.bravo.title),
		'Artist search'
	);
	logProgress('[check 4/26] q matches an artist');

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
	logProgress('[check 5/26] q matches a description');

	const caseInsensitiveHtml = await trackPage({ q: seed.caseText.toLowerCase() });
	assertIncludesAll(
		caseInsensitiveHtml,
		[seed.tracks.charlie.title],
		'Case-insensitive search'
	);
	logProgress('[check 6/26] q matching is case-insensitive');

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
	logProgress('[check 7/26] percent and underscore are searched literally');

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
	logProgress('[check 8/26] bpmMin is inclusive and excludes null BPM');

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
	logProgress('[check 9/26] bpmMax is inclusive and excludes null BPM');

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
	logProgress('[check 10/26] the inclusive BPM range works');

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
	logProgress('[check 11/26] musicalKey uses an exact stored-value match');

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
	logProgress('[check 12/26] genre uses an exact stored-value match');

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
	logProgress('[check 13/26] q, BPM, musical key, and genre combine with AND');

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
	logProgress('[check 14/26] newest sorting is deterministic');

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
	logProgress('[check 15/26] oldest sorting is deterministic');

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
	logProgress('[check 16/26] title_asc is case-insensitive and deterministic');

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
	logProgress('[check 17/26] bpm_asc uses numeric order');

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
	logProgress('[check 18/26] bpm_desc uses numeric order');

	assert(
		bpmAscendingHtml.indexOf(seed.tracks.delta.title) >
			bpmAscendingHtml.indexOf(seed.tracks.charlie.title) &&
			bpmDescendingHtml.indexOf(seed.tracks.delta.title) >
				bpmDescendingHtml.indexOf(seed.tracks.alpha.title),
		'Null BPM was not placed after numeric BPM in both directions.'
	);
	logProgress('[check 19/26] null BPM placement is deterministic and last');

	const invalidBpmHtml = await trackPage({ q: seed.token, bpmMin: '12.5' });
	assert(
		invalidBpmHtml.includes(
			'Minimum BPM must be an integer between 20 and 300.'
		),
		'Invalid minimum BPM did not render its validation message.'
	);
	assertExcludesAll(invalidBpmHtml, publicTitles, 'Invalid minimum BPM results');
	logProgress('[check 20/26] invalid BPM renders validation instead of a 500');

	const invalidKeyHtml = await trackPage({
		q: seed.token,
		musicalKey: 'Definitely not a key'
	});
	assert(
		invalidKeyHtml.includes('The selected musical key is not valid.'),
		'Invalid musical key did not render its validation message.'
	);
	assertExcludesAll(invalidKeyHtml, publicTitles, 'Invalid musical-key results');
	logProgress('[check 21/26] invalid musical key renders validation instead of a 500');

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
	logProgress('[check 22/26] an inverted BPM range renders validation');

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
	logProgress('[check 23/26] submitted values remain visible in the rendered form');

	assert(hasResetLink(preservedHtml), 'The filter form did not provide a Reset filters link to /tracks.');
	logProgress('[check 24/26] Reset filters links exactly to /tracks');

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
	logProgress('[check 25/26] responses expose no internal IDs, stored filenames, or paths');

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
	logProgress('[check 26/26] result-track streaming, Range playback, and download still work');
}

async function runIntegration() {
	logProgress('[setup] capturing real-data baseline');
	const realDatabase = resolveConfiguredPath(
		process.env.DATABASE_URL,
		'data/app.db'
	);
	const realAudioRoot = resolveConfiguredPath(
		process.env.AUDIO_STORAGE_PATH,
		'storage/audio'
	);
	const realStateBefore = await realStateSnapshot(realDatabase, realAudioRoot);
	throwIfAborted();
	realStateForCleanup = {
		realDatabase,
		realAudioRoot,
		realStateBefore
	};

	temporaryRoot = await mkdtemp(join(resolve(tmpdir()), TEMP_PREFIX));
	throwIfAborted();
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
	throwIfAborted();

	const seed = await seedTemporaryData(temporaryDatabase, temporaryAudioRoot);
	throwIfAborted();
	testPort = await reservePort();
	throwIfAborted();
	const baseUrl = `http://127.0.0.1:${testPort}`;
	const cookieName = `phase5_integration_${randomBytes(4).toString('hex')}`;

	logProgress('[setup] isolated database, audio storage, and port are ready');

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

	logProgress('[startup] waiting for the directly launched Vite child');
	await waitForStartup(baseUrl);
	await runHttpChecks(baseUrl, seed, temporaryAudioRoot);
	throwIfAborted();

	const verificationState = await runDatabaseHelper({
		action: 'capture-database-state',
		databasePath: temporaryDatabase,
		exclusions: {
			userIds: [seed.userId],
			trackIds: Object.values(seed.tracks).map((track) => track.internalId)
		}
	});
	throwIfAborted();

	assert(
		snapshotsEqual(
			seed.databaseStateBefore,
			verificationState.databaseState
		),
		'A pre-existing row changed in the temporary database copy.'
	);
	console.log('[isolation] pre-existing database rows remained unchanged');

	const realStateDuring = await realStateSnapshot(realDatabase, realAudioRoot);
	throwIfAborted();
	assert(
		snapshotsEqual(realStateBefore, realStateDuring),
		'The real database or audio storage changed during isolated integration tests.'
	);
	console.log('[isolation] real database and storage/audio remained unchanged');
}

async function removeTemporaryDirectoryWithRetry() {
	if (!temporaryRoot || !existsSync(temporaryRoot)) {
		return;
	}

	const attempts = 12;
	const deadline = Date.now() + TEMP_REMOVE_TIMEOUT_MS;
	let lastError;

	for (let attempt = 1; attempt <= attempts && Date.now() < deadline; attempt += 1) {
		try {
			await rm(temporaryRoot, {
				recursive: true,
				force: true,
				maxRetries: 1,
				retryDelay: 100
			});

			if (!existsSync(temporaryRoot)) {
				return;
			}

			lastError = new Error('The temporary directory still exists.');
		} catch (error) {
			lastError = error;
		}

		console.error(
			`[cleanup 6/7] temporary-directory retry ${attempt}/${attempts} (${
				lastError && typeof lastError === 'object' && 'code' in lastError
					? `code ${String(lastError.code)}`
					: 'unknown error'
			})`
		);

		if (attempt < attempts && Date.now() < deadline) {
			await delay(250, { abortable: false });
		}
	}

	throw new Error(
		`The temporary directory was not removed within ${TEMP_REMOVE_TIMEOUT_MS / 1000} seconds.`
	);
}

function cleanup(realState) {
	if (!cleanupPromise) {
		cleanupPromise = performCleanup(realState);
	}

	return cleanupPromise;
}

async function performCleanup(realState) {
	const cleanupErrors = [];

	if (!overallController.signal.aborted) {
		overallController.abort(
			new Error('Phase 5 integration entered final cleanup.')
		);
	}

	function recordCleanupError(step, error) {
		cleanupErrors.push(error);
		console.error(
			`[cleanup] ${step} failed (${error instanceof Error ? error.name : 'UnknownError'}).`
		);
	}

	logProgress('[cleanup 1/7] aborting HTTP requests and response bodies');
	try {
		cancelActiveHttpOperations();
		assert(
			activeHttpRequests.size === 0 &&
				activeHttpResponses.size === 0 &&
				activeRequestControllers.size === 0,
			'An HTTP resource remained active after cancellation.'
		);
	} catch (error) {
		recordCleanupError('HTTP cancellation', error);
	}

	logProgress('[cleanup 2/7] terminating the exact Vite child');
	try {
		await stopChildProcess();
	} catch (error) {
		recordCleanupError('owned Vite process stop', error);
	}
	try {
		await stopDatabaseHelperProcess();
	} catch (error) {
		recordCleanupError('owned database-helper process stop', error);
	}

	logProgress('[cleanup 3/7] closing Vite stdout and stderr');
	const streamResults = await Promise.allSettled([
		closeChildStream(child?.stdout, 'stdout'),
		closeChildStream(child?.stderr, 'stderr'),
		closeChildStream(databaseHelperProcess?.stdout, 'database-helper stdout'),
		closeChildStream(databaseHelperProcess?.stderr, 'database-helper stderr')
	]);

	for (const result of streamResults) {
		if (result.status === 'rejected') {
			recordCleanupError('Vite output stream close', result.reason);
		}
	}

	logProgress('[cleanup 4/7] verifying child exit and port release');
	let processStopped = true;
	let portReleased = true;

	if (child?.pid && isProcessAlive(child.pid)) {
		processStopped = false;
		recordCleanupError(
			'process postcondition',
			new Error('The exact Vite child remained active.')
		);
	}
	if (databaseHelperProcess?.pid && isProcessAlive(databaseHelperProcess.pid)) {
		processStopped = false;
		recordCleanupError(
			'database-helper process postcondition',
			new Error('The owned database helper remained active.')
		);
	}

	if (testPort) {
		try {
			await waitForPortRelease(testPort);
		} catch (error) {
			portReleased = false;
			recordCleanupError('port postcondition', error);
		}
	}

	logProgress('[cleanup 5/7] verifying real database and audio storage');
	if (realState) {
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
	}

	logProgress('[cleanup 6/7] removing the validated temporary directory');
	if (temporaryRoot && existsSync(temporaryRoot)) {
		if (!processStopped || !portReleased) {
			recordCleanupError(
				'temporary-directory safety gate',
				new Error(
					'Temporary removal was skipped because the exact child or test port remained active.'
				)
			);
		} else {
			try {
				assert(
					isSafeTemporaryRoot(temporaryRoot),
					'Refusing to remove an unvalidated temporary directory.'
				);
				await removeTemporaryDirectoryWithRetry();
				assert(
					!existsSync(temporaryRoot),
					'The integration temporary directory was not removed.'
				);
			} catch (error) {
				recordCleanupError('temporary-directory postcondition', error);
			}
		}
	}

	logProgress('[cleanup 7/7] clearing timers and inspecting active resource types');
	for (const timer of [...activeTimers]) {
		clearTrackedTimeout(timer);
	}
	printActiveResources('after Phase 5 cleanup');

	if (cleanupErrors.length > 0) {
		throw new AggregateError(cleanupErrors, 'Phase 5 integration cleanup failed.');
	}

	logProgress('[cleanup complete] HTTP, Vite, streams, port, timers, and temporary data closed');
}

let primaryError;
let integrationPassed = false;
const overallTimer = trackedTimeout(() => {
	watchdogExpired = true;
	failureProgressStep ??= lastProgressStep;
	const error = new Error(
		`The Phase 5 watchdog expired after ${OVERALL_TIMEOUT_MS / 1000} seconds.`
	);
	primaryError ??= error;
	console.error(`[watchdog] last progress: ${failureProgressStep}`);
	printActiveResources('when the Phase 5 watchdog expired');
	overallController.abort(error);
	void cleanup(realStateForCleanup).catch((cleanupError) => {
		console.error(
			`[cleanup failure] ${safeDiagnostic(
				cleanupError instanceof Error
					? cleanupError.message
					: String(cleanupError)
			)}`
		);
	});
}, OVERALL_TIMEOUT_MS);

try {
	await runIntegration();
	integrationPassed = true;
} catch (error) {
	failureProgressStep ??= lastProgressStep;
	primaryError ??= error;
	console.error(
		`[failure] ${safeDiagnostic(
			error instanceof Error ? error.message : String(error)
		)}`
	);

	if (!startupComplete || watchdogExpired) {
		printServerLogs();
	}
} finally {
	clearTrackedTimeout(overallTimer);

	try {
		await cleanup(realStateForCleanup);
	} catch (cleanupError) {
		console.error(
			`[cleanup failure] ${
				safeDiagnostic(
					cleanupError instanceof Error
						? cleanupError.message
						: String(cleanupError)
				)
			}`
		);

		primaryError ??= cleanupError;
	}
}

if (primaryError) {
	console.error(`[exit] code 1; last test progress: ${failureProgressStep}`);
	printActiveResources('immediately before Phase 5 exit');
	process.exitCode = 1;
} else if (integrationPassed) {
	console.log('PHASE5_INTEGRATION_CHECKS_PASSED=26');
	console.log('[exit] code 0');
	printActiveResources('immediately before Phase 5 exit');
	process.exitCode = 0;
}

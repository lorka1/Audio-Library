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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { config as loadEnvironment } from 'dotenv';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMP_PREFIX = 'audio-library-phase6-integration-';
const STARTUP_TIMEOUT_MS = 60_000;
const OVERALL_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 8_000;
const LOG_TAIL_LIMIT = 64 * 1024;

loadEnvironment({ path: join(PROJECT_ROOT, '.env'), quiet: true });

let child;
let childClosePromise;
let childClosed = false;
let temporaryRoot;
let temporaryClient;
let testPort;
let stdoutPath;
let stderrPath;
let stdoutTail = '';
let stderrTail = '';
let startupComplete = false;
let realStateForCleanup;
let cleanupPromise;

const overallController = new AbortController();
const httpAgent = new HttpAgent({ keepAlive: false });
const activeHttpRequests = new Set();
const activeHttpResponses = new Set();

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

async function waitForChildClose(milliseconds) {
	let timeout;

	try {
		return await Promise.race([
			childClosePromise.then(() => true),
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
		let clientResponse;
		const timeout = setTimeout(() => {
			const timeoutError = new Error(
				`HTTP request to ${url.pathname} exceeded 10 seconds.`
			);
			clientResponse?.destroy(timeoutError);
			clientRequest?.destroy(timeoutError);
			finish(timeoutError);
		}, REQUEST_TIMEOUT_MS);

		function finish(error, response) {
			if (completed) {
				return;
			}

			completed = true;
			clearTimeout(timeout);
			overallController.signal.removeEventListener('abort', onAbort);
			activeHttpRequests.delete(clientRequest);
			activeHttpResponses.delete(clientResponse);

			if (error) {
				reject(error);
			} else {
				resolveResponse(response);
			}
		}

		function onAbort() {
			clientResponse?.destroy(overallController.signal.reason);
			clientRequest?.destroy(overallController.signal.reason);
			finish(overallController.signal.reason ?? new Error('HTTP request aborted.'));
		}

		clientRequest = httpRequest(
			{
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
			},
			(incomingResponse) => {
				clientResponse = incomingResponse;
				activeHttpResponses.add(clientResponse);
				clientResponse.on('data', (chunk) => chunks.push(chunk));
				clientResponse.once('aborted', () => {
					finish(new Error(`HTTP response from ${url.pathname} was aborted.`));
				});
				clientResponse.once('error', (error) => {
					clientResponse.destroy();
					finish(error);
				});
				clientResponse.once('close', () => {
					if (!completed && !clientResponse.complete) {
						finish(
							new Error(`HTTP response from ${url.pathname} closed prematurely.`)
						);
					}
				});
				clientResponse.once('end', () => {
					const body = Buffer.concat(chunks);
					finish(null, {
						bodyBytes: body,
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
			}
		);

		overallController.signal.addEventListener('abort', onAbort, { once: true });
		activeHttpRequests.add(clientRequest);
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

async function waitForPortRelease(port, milliseconds = SHUTDOWN_TIMEOUT_MS) {
	const deadline = Date.now() + milliseconds;

	do {
		if (!(await canConnect(port))) {
			return;
		}

		await delay(150);
	} while (Date.now() < deadline);

	throw new Error(`The integration port ${port} is still accepting connections.`);
}

function cancelActiveHttpOperations() {
	const cancellationError = new Error(
		'Phase 6 integration cleanup cancelled an active HTTP operation.'
	);

	for (const response of activeHttpResponses) {
		response.destroy(cancellationError);
	}

	for (const clientRequest of activeHttpRequests) {
		clientRequest.destroy(cancellationError);
	}

	activeHttpResponses.clear();
	activeHttpRequests.clear();
}

function readErrorCode(error) {
	if (typeof error !== 'object' || error === null || !('code' in error)) {
		return undefined;
	}

	const code = error.code;
	return typeof code === 'string' || typeof code === 'number' ? code : undefined;
}

async function remainingTemporaryEntryCategories(root) {
	try {
		const entries = await readdir(root, { withFileTypes: true });
		const categories = entries.map((entry) => {
			if (entry.name === 'app.db' || entry.name.startsWith('app.db-')) {
				return 'database file';
			}

			if (entry.name === 'audio' && entry.isDirectory()) {
				return 'audio directory';
			}

			if (entry.name === 'vite.out.log' || entry.name === 'vite.err.log') {
				return 'Vite log';
			}

			return entry.isDirectory() ? 'temporary directory' : 'temporary file';
		});

		return [...new Set(categories)].join(', ') || 'none';
	} catch (error) {
		return readErrorCode(error) === 'ENOENT' ? 'none' : 'unavailable';
	}
}

async function removeTemporaryDirectoryWithRetry(root) {
	const attempts = process.platform === 'win32' ? 12 : 3;
	let lastError;

	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			await rm(root, {
				recursive: true,
				force: true,
				maxRetries: process.platform === 'win32' ? 2 : 0,
				retryDelay: 100
			});

			if (!existsSync(root)) {
				return;
			}

			lastError = new Error('The temporary directory still exists.');
		} catch (error) {
			lastError = error;
		}

		const errorCode = readErrorCode(lastError) ?? 'unknown';
		const retainedEntries = await remainingTemporaryEntryCategories(root);
		console.error(
			`[cleanup] temporary-directory retry ${attempt}/${attempts} (code ${errorCode}; retained: ${retainedEntries})`
		);

		if (attempt < attempts) {
			await delay(250);
		}
	}

	const errorCode = readErrorCode(lastError) ?? 'unknown';
	const retainedEntries = await remainingTemporaryEntryCategories(root);
	throw new Error(
		`The integration temporary directory could not be removed after ${attempts} attempts (code ${errorCode}; retained: ${retainedEntries}).`
	);
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

function assertBytes(actual, expected, context) {
	assert(
		Buffer.from(actual).equals(Buffer.from(expected)),
		`${context} bytes did not match the expected file bytes.`
	);
}

function responseBodyParts(path, response, bodyBytes, bodyKind) {
	if (bodyKind === 'media body') {
		return [{ location: 'media body', content: bodyBytes }];
	}

	if (path.endsWith('/__data.json')) {
		return [{ location: 'serialized page data', content: bodyBytes }];
	}

	const contentType = response.headers.get('content-type') ?? '';

	if (contentType.toLowerCase().includes('text/html')) {
		const text = bodyBytes.toString('utf8');
		const scriptPattern = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
		const serializedParts = [...text.matchAll(scriptPattern)].map((match) => ({
			location: 'serialized page data embedded in HTML',
			content: match[0]
		}));
		const markup = text.replace(
			/<script\b[^>]*>[\s\S]*?<\/script>/gi,
			''
		);

		return [
			...serializedParts,
			{ location: 'HTML', content: markup }
		];
	}

	return [{ location: 'response body', content: bodyBytes }];
}

function createResponseArtifact({
	requestNumber,
	checkReference,
	method,
	path,
	response,
	bodyKind
}) {
	const parts = [];

	for (const [name, value] of response.headers.entries()) {
		parts.push({
			location:
				name.toLowerCase() === 'location'
					? 'redirect Location'
					: `response header (${name.toLowerCase()})`,
			content: value
		});
	}

	parts.push(
		...responseBodyParts(
			path,
			response,
			response.bodyBytes,
			bodyKind
		)
	);

	return {
		requestNumber,
		checkReference,
		method,
		path,
		status: response.status,
		parts
	};
}

function forbiddenVariants(value) {
	const candidates = [
		['raw', value],
		['slash-normalized', value.replaceAll('\\', '/')],
		['percent-encoded', encodeURIComponent(value)],
		['URI-encoded', encodeURI(value)]
	];
	const seen = new Set();

	return candidates.filter(([, variant]) => {
		if (!variant || seen.has(variant)) {
			return false;
		}

		seen.add(variant);
		return true;
	});
}

function contentIncludes(content, value) {
	return Buffer.isBuffer(content)
		? content.includes(Buffer.from(value, 'utf8'))
		: content.includes(value);
}

function safeFingerprint(value) {
	return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
}

function assertNoForbiddenValues(artifacts, forbiddenValues) {
	for (const artifact of artifacts) {
		for (const forbidden of forbiddenValues) {
			const value = String(forbidden.value ?? '');

			for (const [encoding, variant] of forbiddenVariants(value)) {
				const part = artifact.parts.find((candidate) =>
					contentIncludes(candidate.content, variant)
				);

				if (!part) {
					continue;
				}

				console.error(
					`[privacy] request #${artifact.requestNumber} (check ${artifact.checkReference})`
				);
				console.error(
					`[privacy] ${artifact.method} ${artifact.path} -> ${artifact.status}`
				);
				console.error(`[privacy] match location: ${part.location}`);
				console.error(
					`[privacy] forbidden category: ${forbidden.category} (${forbidden.subject})`
				);
				console.error(
					`[privacy] matched value: <redacted length=${value.length} sha256:${safeFingerprint(value)}> encoding=${encoding}`
				);

				throw new Error(
					'Phase 6 response privacy check failed; see the redacted diagnostic above.'
				);
			}
		}
	}
}

function formBody(values) {
	return new URLSearchParams(values).toString();
}

function formHeaders(baseUrl, cookie) {
	return {
		Accept: 'text/html',
		'Content-Type': 'application/x-www-form-urlencoded',
		Cookie: cookie,
		Origin: baseUrl
	};
}

async function trackRow(publicId) {
	const result = await temporaryClient.execute({
		sql: 'select * from tracks where public_id = ?',
		args: [publicId]
	});
	return result.rows[0] ?? null;
}

function normalizeDatabaseRows(rows) {
	return rows.map((row) =>
		Object.fromEntries(
			Object.entries(row).map(([key, value]) => [
				key,
				typeof value === 'bigint' ? value.toString() : value
			])
		)
	);
}

async function captureDatabaseState(exclusions = {}) {
	const excludedUserIds = new Set(
		(exclusions.userIds ?? []).map((value) => String(value))
	);
	const excludedTrackIds = new Set(
		(exclusions.trackIds ?? []).map((value) => String(value))
	);
	const [users, sessions, tracks] = await Promise.all([
		temporaryClient.execute('select * from users order by id'),
		temporaryClient.execute('select * from sessions order by id'),
		temporaryClient.execute('select * from tracks order by id')
	]);

	return {
		users: normalizeDatabaseRows(users.rows).filter(
			(row) => !excludedUserIds.has(String(row.id))
		),
		sessions: normalizeDatabaseRows(sessions.rows).filter(
			(row) => !excludedUserIds.has(String(row.user_id))
		),
		tracks: normalizeDatabaseRows(tracks.rows).filter(
			(row) => !excludedTrackIds.has(String(row.id))
		)
	};
}

async function seedTemporaryData(temporaryDatabase, temporaryAudioRoot) {
	temporaryClient = createClient({
		url: pathToFileURL(temporaryDatabase).href
	});

	const quickCheck = await temporaryClient.execute('pragma quick_check');
	assert(
		quickCheck.rows[0]?.quick_check === 'ok',
		'The temporary database copy failed SQLite quick_check.'
	);

	const databaseStateBefore = await captureDatabaseState();

	const suffix = `${Date.now()}_${randomBytes(4).toString('hex')}`;
	const nowSeconds = Math.floor(Date.now() / 1000);
	const users = {
		owner: {
			id: randomUUID(),
			username: `phase6_owner_${randomBytes(4).toString('hex')}`,
			email: `phase6-owner-${suffix}@example.test`,
			token: randomBytes(32).toString('base64url')
		},
		other: {
			id: randomUUID(),
			username: `phase6_other_${randomBytes(4).toString('hex')}`,
			email: `phase6-other-${suffix}@example.test`,
			token: randomBytes(32).toString('base64url')
		}
	};

	for (const user of Object.values(users)) {
		await temporaryClient.execute({
			sql: 'insert into users (id, email, username, password_hash, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
			args: [
				user.id,
				user.email,
				user.username,
				'synthetic-phase6-password-hash',
				nowSeconds,
				nowSeconds
			]
		});
		await temporaryClient.execute({
			sql: 'insert into sessions (id, token_hash, user_id, expires_at, created_at) values (?, ?, ?, ?, ?)',
			args: [
				randomUUID(),
				createHash('sha256').update(user.token, 'utf8').digest('hex'),
				user.id,
				nowSeconds + 3600,
				nowSeconds
			]
		});
	}

	await mkdir(temporaryAudioRoot, { recursive: true });

	const bytes = {
		public: Buffer.from(Array.from({ length: 96 }, (_, index) => (index * 13) % 256)),
		private: Buffer.from([11, 12, 13, 14]),
		deleted: Buffer.from([21, 22, 23, 24, 25]),
		other: Buffer.from([31, 32, 33, 34])
	};
	const marker = `phase6needle${randomBytes(4).toString('hex')}`;
	const definitions = [
		{
			key: 'ownerPublic',
			ownerId: users.owner.id,
			title: `Owner public ${marker}`,
			artist: 'Owner Artist',
			bpm: 120,
			musicalKey: 'C minor',
			genre: 'Techno',
			description: `Searchable ${marker}.`,
			visibility: 'public',
			fileBytes: bytes.public,
			createdAt: nowSeconds - 500
		},
		{
			key: 'ownerPrivate',
			ownerId: users.owner.id,
			title: `Owner private ${suffix}`,
			artist: 'Private Owner Artist',
			bpm: null,
			musicalKey: null,
			genre: null,
			description: null,
			visibility: 'private',
			fileBytes: bytes.private,
			createdAt: nowSeconds - 400
		},
		{
			key: 'ownerDelete',
			ownerId: users.owner.id,
			title: `Owner delete ${suffix}`,
			artist: 'Delete Artist',
			bpm: 130,
			musicalKey: 'D minor',
			genre: 'Electronic',
			description: 'Delete this synthetic track.',
			visibility: 'public',
			fileBytes: bytes.deleted,
			createdAt: nowSeconds - 300
		},
		{
			key: 'ownerMissing',
			ownerId: users.owner.id,
			title: `Owner missing ${suffix}`,
			artist: 'Missing Artist',
			bpm: 90,
			musicalKey: 'A minor',
			genre: 'Ambient',
			description: 'The physical file is intentionally absent.',
			visibility: 'private',
			fileBytes: null,
			createdAt: nowSeconds - 200
		},
		{
			key: 'otherPublic',
			ownerId: users.other.id,
			title: `Other public ${suffix}`,
			artist: 'Other Artist',
			bpm: 140,
			musicalKey: 'E minor',
			genre: 'Rock',
			description: 'Another user owns this track.',
			visibility: 'public',
			fileBytes: bytes.other,
			createdAt: nowSeconds - 100
		}
	];
	const tracks = {};

	for (const definition of definitions) {
		const internalId = randomUUID();
		const storedFilename = `${randomUUID()}.mp3`;
		const originalFilename = `${definition.key}.mp3`;
		const fileSizeBytes = definition.fileBytes?.length ?? 8;

		await temporaryClient.execute({
			sql: `insert into tracks (
				id, owner_id, title, artist, bpm, musical_key, genre, description,
				original_filename, storage_key, mime_type, file_size_bytes,
				duration_ms, visibility, created_at, updated_at
			) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				internalId,
				definition.ownerId,
				definition.title,
				definition.artist,
				definition.bpm,
				definition.musicalKey,
				definition.genre,
				definition.description,
				originalFilename,
				storedFilename,
				'audio/mpeg',
				fileSizeBytes,
				null,
				definition.visibility,
				definition.createdAt,
				definition.createdAt
			]
		});

		const idResult = await temporaryClient.execute({
			sql: 'select public_id from tracks where id = ?',
			args: [internalId]
		});
		const publicId = Number(idResult.rows[0]?.public_id);
		assert(
			Number.isSafeInteger(publicId) && publicId > 0,
			'A synthetic Phase 6 track did not receive a positive public ID.'
		);

		if (definition.fileBytes) {
			await writeFile(
				join(temporaryAudioRoot, storedFilename),
				definition.fileBytes
			);
		}

		tracks[definition.key] = {
			...definition,
			internalId,
			storedFilename,
			originalFilename,
			publicId
		};
	}

	return {
		users,
		tracks,
		bytes,
		marker,
		databaseStateBefore,
		forbiddenValues: [
			...Object.entries(users).flatMap(([subject, user]) => [
				{ category: 'owner ID', subject, value: user.id },
				{ category: 'owner email', subject, value: user.email },
				{ category: 'session token', subject, value: user.token }
			]),
			...Object.entries(tracks).flatMap(([subject, track]) => [
				{ category: 'internal track UUID', subject, value: track.internalId },
				{ category: 'storage filename/storage key', subject, value: track.storedFilename }
			])
		]
	};
}

async function runHttpChecks(
	baseUrl,
	seed,
	cookieName,
	temporaryAudioRoot
) {
	const responseArtifacts = [];
	let requestNumber = 0;
	const ownerCookie = `${cookieName}=${seed.users.owner.token}`;
	const otherCookie = `${cookieName}=${seed.users.other.token}`;

	async function responseText(checkReference, path, options = {}) {
		const response = await request(baseUrl, path, options);
		const text = await response.text();
		requestNumber += 1;
		responseArtifacts.push(
			createResponseArtifact({
				requestNumber,
				checkReference,
				method: options.method ?? 'GET',
				path,
				response
			})
		);
		return { response, text };
	}

	const signedOut = await responseText('1', '/my-tracks');
	assert(
		signedOut.response.status === 303 &&
			(signedOut.response.headers.get('location') ?? '').startsWith(
				'/login?redirectTo='
			),
		'Signed-out My Tracks access did not redirect to login.'
	);
	console.log('[check 1/31] signed-out /my-tracks redirects to login');

	const myTracks = await responseText('2-5', '/my-tracks', {
		headers: { Cookie: ownerCookie }
	});
	assert(myTracks.response.status === 200, 'Owner could not open /my-tracks.');
	console.log('[check 2/31] owner can open /my-tracks');

	assert(
		[
			seed.tracks.ownerPublic.title,
			seed.tracks.ownerPrivate.title,
			seed.tracks.ownerDelete.title,
			seed.tracks.ownerMissing.title
		].every((title) => myTracks.text.includes(title)),
		'My Tracks omitted an owned track.'
	);
	console.log('[check 3/31] My Tracks includes every owner track');

	assert(
		!myTracks.text.includes(seed.tracks.otherPublic.title),
		"My Tracks exposed another user's track."
	);
	console.log("[check 4/31] another user's tracks are excluded");

	assert(
		myTracks.text.includes(seed.tracks.ownerPrivate.title) &&
			myTracks.text.includes('Private') &&
			!myTracks.text.includes(
				`href="/tracks/${seed.tracks.ownerPrivate.publicId}"`
			),
		'The private owned track was missing or linked as public.'
	);
	console.log('[check 5/31] private owned track appears without a public detail link');

	const ownerEdit = await responseText(
		'6',
		`/my-tracks/${seed.tracks.ownerPublic.publicId}/edit`,
		{ headers: { Cookie: ownerCookie } }
	);
	assert(
		ownerEdit.response.status === 200 &&
			ownerEdit.text.includes(seed.tracks.ownerPublic.title),
		'Owner could not open the metadata edit page.'
	);
	console.log('[check 6/31] owner can open their edit page');

	const nonOwnerEdit = await responseText(
		'7',
		`/my-tracks/${seed.tracks.ownerPublic.publicId}/edit`,
		{ headers: { Cookie: otherCookie } }
	);
	assert(
		nonOwnerEdit.response.status === 404,
		'Non-owner edit access did not return a safe 404.'
	);
	console.log('[check 7/31] non-owner edit page returns safe 404');

	const beforeUpdate = await trackRow(seed.tracks.ownerPublic.publicId);
	const updatedTitle = `Updated ${seed.marker}`;
	const validUpdate = await responseText(
		'8',
		`/my-tracks/${seed.tracks.ownerPublic.publicId}/edit`,
		{
			method: 'POST',
			headers: formHeaders(baseUrl, ownerCookie),
			body: formBody({
				title: updatedTitle,
				artist: 'Updated Owner Artist',
				bpm: '128',
				musicalKey: 'D minor',
				genre: 'Electronic',
				description: 'Updated owner-safe description.',
				ownerId: seed.users.other.id,
				visibility: 'private',
				publicId: String(seed.tracks.otherPublic.publicId),
				storageKey: seed.tracks.otherPublic.storedFilename
			})
		}
	);
	assert(
		validUpdate.response.status === 303 &&
			validUpdate.response.headers.get('location') === '/my-tracks?updated=1',
		'Valid owner metadata update did not use Post/Redirect/Get.'
	);
	console.log('[check 8/31] valid owner update redirects successfully');

	const afterUpdate = await trackRow(seed.tracks.ownerPublic.publicId);
	assert(
		afterUpdate?.title === updatedTitle &&
			afterUpdate?.artist === 'Updated Owner Artist' &&
			Number(afterUpdate?.bpm) === 128 &&
			afterUpdate?.musical_key === 'D minor' &&
			afterUpdate?.genre === 'Electronic' &&
			afterUpdate?.description === 'Updated owner-safe description.',
		'Updated metadata was not persisted.'
	);
	console.log('[check 9/31] updated metadata is persisted');

	assert(
		afterUpdate?.owner_id === beforeUpdate?.owner_id,
		'Metadata editing changed ownership.'
	);
	console.log('[check 10/31] ownership is unchanged');

	assert(
		afterUpdate?.visibility === beforeUpdate?.visibility,
		'Metadata editing changed visibility.'
	);
	console.log('[check 11/31] visibility is unchanged');

	assert(
		Number(afterUpdate?.public_id) === Number(beforeUpdate?.public_id) &&
			afterUpdate?.id === beforeUpdate?.id,
		'Metadata editing changed a public or internal track ID.'
	);
	console.log('[check 12/31] public and internal IDs are unchanged');

	assert(
		afterUpdate?.storage_key === beforeUpdate?.storage_key &&
			afterUpdate?.original_filename === beforeUpdate?.original_filename,
		'Metadata editing changed stored or original filename metadata.'
	);
	console.log('[check 13/31] storage and original filenames are unchanged');

	assertBytes(
		await readFile(
			join(temporaryAudioRoot, seed.tracks.ownerPublic.storedFilename)
		),
		seed.bytes.public,
		'Edited track physical file'
	);
	console.log('[check 14/31] physical audio bytes are unchanged after editing');

	const invalidUpdate = await responseText(
		'15',
		`/my-tracks/${seed.tracks.ownerPublic.publicId}/edit`,
		{
			method: 'POST',
			headers: formHeaders(baseUrl, ownerCookie),
			body: formBody({
				title: '   ',
				artist: 'Still Safe Artist',
				bpm: '120.5',
				musicalKey: 'Not a key',
				genre: 'Not a genre',
				description: 'Preserved description'
			})
		}
	);
	const afterInvalidUpdate = await trackRow(seed.tracks.ownerPublic.publicId);
	assert(
		invalidUpdate.response.status === 400 &&
			invalidUpdate.text.includes('Title is required.') &&
			invalidUpdate.text.includes('BPM must be an integer.') &&
			invalidUpdate.text.includes('Select a valid musical key.') &&
			invalidUpdate.text.includes('Select a valid genre.') &&
			snapshotsEqual(afterUpdate, afterInvalidUpdate),
		'Invalid metadata did not render safely without changing the database.'
	);
	console.log('[check 15/31] invalid metadata is preserved and rejected');

	const otherRowAfterForgery = await trackRow(seed.tracks.otherPublic.publicId);
	assert(
		afterUpdate?.owner_id === seed.users.owner.id &&
			afterUpdate?.visibility === 'public' &&
			otherRowAfterForgery?.owner_id === seed.users.other.id &&
			otherRowAfterForgery?.title === seed.tracks.otherPublic.title,
		'Forged owner or immutable form fields had an effect.'
	);
	console.log('[check 16/31] forged owner and immutable fields have no effect');

	const deleteConfirmation = await responseText(
		'17',
		`/my-tracks/${seed.tracks.ownerDelete.publicId}/delete`,
		{ headers: { Cookie: ownerCookie } }
	);
	assert(
		deleteConfirmation.response.status === 200 &&
			deleteConfirmation.text.includes(seed.tracks.ownerDelete.title) &&
			deleteConfirmation.text.includes('Delete permanently'),
		'Owner could not open deletion confirmation.'
	);
	console.log('[check 17/31] owner can open deletion confirmation');

	const nonOwnerDeleteConfirmation = await responseText(
		'18',
		`/my-tracks/${seed.tracks.ownerDelete.publicId}/delete`,
		{ headers: { Cookie: otherCookie } }
	);
	assert(
		nonOwnerDeleteConfirmation.response.status === 404,
		'Non-owner deletion confirmation did not return 404.'
	);
	console.log('[check 18/31] non-owner deletion confirmation returns 404');

	assert(
		(await trackRow(seed.tracks.ownerDelete.publicId)) !== null &&
			(await optionalFileSnapshot(
				join(temporaryAudioRoot, seed.tracks.ownerDelete.storedFilename)
			)) !== null,
		'Opening deletion confirmation through GET deleted data.'
	);
	console.log('[check 19/31] GET confirmation does not delete');

	const nonOwnerDeletePost = await responseText(
		'20',
		`/my-tracks/${seed.tracks.ownerDelete.publicId}/delete`,
		{
			method: 'POST',
			headers: formHeaders(baseUrl, otherCookie),
			body: ''
		}
	);
	assert(
		nonOwnerDeletePost.response.status === 404 &&
			(await trackRow(seed.tracks.ownerDelete.publicId)) !== null,
		'Non-owner POST affected the owner track.'
	);
	console.log('[check 20/31] non-owner POST cannot delete');

	const ownerDeletePost = await responseText(
		'21',
		`/my-tracks/${seed.tracks.ownerDelete.publicId}/delete`,
		{
			method: 'POST',
			headers: formHeaders(baseUrl, ownerCookie),
			body: ''
		}
	);
	assert(
		ownerDeletePost.response.status === 303 &&
			ownerDeletePost.response.headers.get('location') ===
				'/my-tracks?deleted=1' &&
			(await trackRow(seed.tracks.ownerDelete.publicId)) === null,
		'Owner POST did not delete the owner-scoped database row.'
	);
	console.log('[check 21/31] owner POST deletes the database row');

	assert(
		(await optionalFileSnapshot(
			join(temporaryAudioRoot, seed.tracks.ownerDelete.storedFilename)
		)) === null,
		'Owner deletion left the physical audio file.'
	);
	console.log('[check 22/31] owner POST deletes the correct physical file');

	assert(
		(await trackRow(seed.tracks.otherPublic.publicId)) !== null,
		"Owner deletion removed another user's row."
	);
	console.log("[check 23/31] another user's row remains");

	assertBytes(
		await readFile(
			join(temporaryAudioRoot, seed.tracks.otherPublic.storedFilename)
		),
		seed.bytes.other,
		"Other user's physical file"
	);
	console.log("[check 24/31] another user's file remains unchanged");

	const missingDeletePost = await responseText(
		'25',
		`/my-tracks/${seed.tracks.ownerMissing.publicId}/delete`,
		{
			method: 'POST',
			headers: formHeaders(baseUrl, ownerCookie),
			body: ''
		}
	);
	assert(
		missingDeletePost.response.status === 303 &&
			(await trackRow(seed.tracks.ownerMissing.publicId)) === null,
		'Missing-file deletion did not safely remove the owned database row.'
	);
	console.log('[check 25/31] missing-file deletion safely removes the owned row');

	const updateTimestamp = (await trackRow(seed.tracks.ownerPublic.publicId))?.updated_at;
	const updateRedirectFirst = await responseText('26', '/my-tracks?updated=1', {
		headers: { Cookie: ownerCookie }
	});
	const updateRedirectSecond = await responseText('26', '/my-tracks?updated=1', {
		headers: { Cookie: ownerCookie }
	});
	assert(
		updateRedirectFirst.response.status === 200 &&
			updateRedirectSecond.response.status === 200 &&
			updateRedirectSecond.text.includes('Track metadata updated successfully.') &&
			(await trackRow(seed.tracks.ownerPublic.publicId))?.updated_at ===
				updateTimestamp,
		'Refreshing the edit success redirect repeated the update.'
	);
	console.log('[check 26/31] successful edit redirect is idempotent');

	const deleteRedirectFirst = await responseText('27', '/my-tracks?deleted=1', {
		headers: { Cookie: ownerCookie }
	});
	const deleteRedirectSecond = await responseText('27', '/my-tracks?deleted=1', {
		headers: { Cookie: ownerCookie }
	});
	assert(
		deleteRedirectFirst.response.status === 200 &&
			deleteRedirectSecond.response.status === 200 &&
			deleteRedirectSecond.text.includes('Track deleted successfully.') &&
			(await trackRow(seed.tracks.ownerDelete.publicId)) === null,
		'Refreshing the deletion success redirect repeated or reversed deletion.'
	);
	console.log('[check 27/31] successful delete redirect is idempotent');

	const search = await responseText(
		'28',
		`/tracks?q=${encodeURIComponent(seed.marker)}`
	);
	assert(
		search.response.status === 200 &&
			search.text.includes(updatedTitle) &&
			!search.text.includes(seed.tracks.ownerPrivate.title),
		'Public Phase 5 search regression failed.'
	);
	console.log('[check 28/31] public Phase 5 search still works');

	const stream = await request(
		baseUrl,
		`/api/tracks/${seed.tracks.ownerPublic.publicId}/stream`
	);
	const streamBytes = new Uint8Array(await stream.arrayBuffer());
	requestNumber += 1;
	responseArtifacts.push(
		createResponseArtifact({
			requestNumber,
			checkReference: '29',
			method: 'GET',
			path: `/api/tracks/${seed.tracks.ownerPublic.publicId}/stream`,
			response: stream,
			bodyKind: 'media body'
		})
	);
	assert(stream.status === 200, 'Public stream regression did not return 200.');
	assertBytes(streamBytes, seed.bytes.public, 'Public stream');
	console.log('[check 29/31] stream still returns correct bytes');

	const download = await request(
		baseUrl,
		`/api/tracks/${seed.tracks.ownerPublic.publicId}/download`
	);
	const downloadBytes = new Uint8Array(await download.arrayBuffer());
	requestNumber += 1;
	responseArtifacts.push(
		createResponseArtifact({
			requestNumber,
			checkReference: '30',
			method: 'GET',
			path: `/api/tracks/${seed.tracks.ownerPublic.publicId}/download`,
			response: download,
			bodyKind: 'media body'
		})
	);
	assert(download.status === 200, 'Public download regression did not return 200.');
	assertBytes(downloadBytes, seed.bytes.public, 'Public download');
	console.log('[check 30/31] download still returns correct bytes');

	const myTracksData = await responseText('31', '/my-tracks/__data.json', {
		headers: { Cookie: ownerCookie }
	});
	const editData = await responseText(
		'31',
		`/my-tracks/${seed.tracks.ownerPublic.publicId}/edit/__data.json`,
		{ headers: { Cookie: ownerCookie } }
	);
	assert(
		myTracksData.response.status === 200 &&
			editData.response.status === 200,
		'Owner-management page data was unavailable.'
	);
	assertNoForbiddenValues(
		responseArtifacts,
		[
			...seed.forbiddenValues,
			{
				category: 'temporary directory path',
				subject: 'integration root',
				value: temporaryRoot
			},
			{
				category: 'temporary database path',
				subject: 'integration database',
				value: join(temporaryRoot, 'app.db')
			},
			{
				category: 'temporary audio-storage path',
				subject: 'integration audio root',
				value: temporaryAudioRoot
			},
			{
				category: 'real database path',
				subject: 'development database',
				value: resolveConfiguredPath(process.env.DATABASE_URL, 'data/app.db')
			},
			{
				category: 'real audio-storage path',
				subject: 'development audio root',
				value: resolveConfiguredPath(
					process.env.AUDIO_STORAGE_PATH,
					'storage/audio'
				)
			}
		]
	);
	console.log('[check 31/31] responses expose no internal IDs, stored filenames, or paths');
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
	if (process.env.PHASE6_FRESH_DATABASE === '1') {
		const migrationClient = createClient({
			url: pathToFileURL(temporaryDatabase).href
		});
		try {
			const migrationFiles = (await readdir(join(PROJECT_ROOT, 'drizzle')))
				.filter((name) => /^\d+_.+\.sql$/.test(name))
				.sort();
			for (const name of migrationFiles) {
				const sql = await readFile(join(PROJECT_ROOT, 'drizzle', name), 'utf8');
				const statements = sql
					.split('--> statement-breakpoint')
					.map((statement) => statement.trim())
					.filter(Boolean);
				if (statements.length > 0) {
					await migrationClient.batch(
						statements.map((statement) => ({ sql: statement, args: [] })),
						'write'
					);
				}
			}
		} finally {
			migrationClient.close();
		}
	} else {
		await copyDatabaseSnapshot(realDatabase, temporaryDatabase);
	}

	const seed = await seedTemporaryData(temporaryDatabase, temporaryAudioRoot);
	testPort = await reservePort();
	const baseUrl = `http://127.0.0.1:${testPort}`;
	const cookieName = `phase6_integration_${randomBytes(4).toString('hex')}`;

	console.log(`[setup] isolated port: ${testPort}`);
	console.log(
		process.env.PHASE6_FRESH_DATABASE === '1'
			? '[setup] fresh temporary SQLite database and audio storage are ready'
			: '[setup] temporary database copy and audio storage are ready'
	);

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
				DATABASE_BACKEND: 'sqlite',
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
		child.once('close', (code, signal) => {
			childClosed = true;
			resolveClose({ code, signal });
		});
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
	await runHttpChecks(
		baseUrl,
		seed,
		cookieName,
		temporaryAudioRoot
	);

	const databaseStateAfter = await captureDatabaseState({
		userIds: Object.values(seed.users).map((user) => user.id),
		trackIds: Object.values(seed.tracks).map((track) => track.internalId)
	});
	assert(
		snapshotsEqual(seed.databaseStateBefore, databaseStateAfter),
		'A pre-existing row changed in the temporary database copy.'
	);

	const realStateDuring = await realStateSnapshot(realDatabase, realAudioRoot);
	assert(
		snapshotsEqual(realStateBefore, realStateDuring),
		'The real database or audio storage changed during isolated integration tests.'
	);
	console.log('[isolation] pre-existing database rows remained unchanged');
	console.log('[isolation] real database and storage/audio remained unchanged');
}

function cleanup(realState) {
	if (!cleanupPromise) {
		cleanupPromise = performCleanup(realState);
	}

	return cleanupPromise;
}

async function performCleanup(realState) {
	const cleanupErrors = [];
	overallController.abort();

	function recordCleanupError(step, error) {
		cleanupErrors.push(error);
		const errorCode = readErrorCode(error);
		console.error(
			`[cleanup] ${step} failed (${error instanceof Error ? error.name : 'UnknownError'}${
				errorCode === undefined ? '' : `; code ${errorCode}`
			}).`
		);
	}

	try {
		cancelActiveHttpOperations();
		httpAgent.destroy();
	} catch (error) {
		recordCleanupError('HTTP response/request cancellation', error);
	}

	try {
		temporaryClient?.close();
		temporaryClient = undefined;
	} catch (error) {
		recordCleanupError('temporary database connection close', error);
	}

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
	}

	try {
		assert(
			[child?.stdout, child?.stderr].every(
				(stream) => !stream || stream.closed || stream.destroyed
			),
			'An owned Vite output stream remained open.'
		);
	} catch (error) {
		recordCleanupError('Vite output stream postcondition', error);
	}

	try {
		assert(
			activeHttpRequests.size === 0 &&
				activeHttpResponses.size === 0 &&
				temporaryClient === undefined,
			'An HTTP or database handle remained open.'
		);
	} catch (error) {
		recordCleanupError('HTTP/database handle postcondition', error);
	}

	let portReleased = true;
	if (testPort) {
		try {
			await waitForPortRelease(testPort);
		} catch (error) {
			portReleased = false;
			recordCleanupError(`port ${testPort} postcondition`, error);
		}
	}

	let childStopped = true;
	if (child?.pid) {
		try {
			assert(
				childClosed && !isProcessAlive(child.pid),
				`The integration Vite process ${child.pid} is still alive.`
			);
		} catch (error) {
			childStopped = false;
			recordCleanupError(`process ${child.pid} postcondition`, error);
		}
	}

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

	if (temporaryRoot && existsSync(temporaryRoot)) {
		if (!childStopped || !portReleased) {
			recordCleanupError(
				'temporary-directory removal safety gate',
				Object.assign(
					new Error(
						'Temporary removal was skipped because the owned process or port was still active.'
					),
					{ code: 'ACTIVE_TEST_SERVER' }
				)
			);
		} else {
			try {
				assert(
					isSafeTemporaryRoot(temporaryRoot),
					'Refusing to remove an unvalidated temporary directory.'
				);
				await removeTemporaryDirectoryWithRetry(temporaryRoot);
				assert(
					!existsSync(temporaryRoot),
					'The integration temporary directory was not removed.'
				);
			} catch (error) {
				recordCleanupError('temporary-directory postcondition', error);
			}
		}
	}

	if (cleanupErrors.length > 0) {
		throw new AggregateError(cleanupErrors, 'Phase 6 integration cleanup failed.');
	}

	console.log(
		'[cleanup] database, HTTP, Vite, port, streams, and temporary directory closed'
	);
}

let primaryError;
let integrationPassed = false;
const overallTimer = setTimeout(() => {
	overallController.abort(
		new Error('The Phase 6 integration test exceeded its 120-second timeout.')
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
	console.log('PHASE6_INTEGRATION_CHECKS_PASSED=31');
	process.exitCode = 0;
}

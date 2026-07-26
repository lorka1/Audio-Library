import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import {
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	stat
} from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnvironment } from 'dotenv';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMP_PREFIX = 'audio-library-clean-clone-';
const TOTAL_STEPS = 12;
const OVERALL_TIMEOUT_MS = 15 * 60_000;
const CLEANUP_RESERVE_MS = 60_000;
const VERIFICATION_TIMEOUT_MS = OVERALL_TIMEOUT_MS - CLEANUP_RESERVE_MS;
const GIT_TIMEOUT_MS = 30_000;
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const MIGRATION_TIMEOUT_MS = 60_000;
const CHECK_TIMEOUT_MS = 90_000;
const TEST_TIMEOUT_MS = 120_000;
const BUILD_TIMEOUT_MS = 120_000;
const STARTUP_TIMEOUT_MS = 45_000;
const REQUEST_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 8_000;
const LOG_TAIL_LIMIT = 64 * 1024;

const ISOLATED_DATABASE_URL = './.release-runtime/app.db';
const ISOLATED_AUDIO_STORAGE_PATH = './.release-runtime/audio';

loadEnvironment({ path: join(PROJECT_ROOT, '.env'), quiet: true });

let temporaryRoot;
let sourceRoot;
let serverPort;
let activeCommand;
let serverProcess;
let realStateForCleanup;
let activeStep = {
	label: 'initialization',
	number: 0
};
let failedStep;

const overallController = new AbortController();
const httpAgent = new HttpAgent({ keepAlive: false });
const activeHttpRequests = new Set();
const activeHttpResponses = new Set();

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function beginStep(number, label) {
	activeStep = { label, number };
	console.log(`[step ${number}/${TOTAL_STEPS}] ${label}`);
}

function completeStep(number) {
	console.log(`[step ${number}/${TOTAL_STEPS}] complete`);
}

function updateTail(current, chunk) {
	const updated = `${current}${chunk}`;
	return updated.length <= LOG_TAIL_LIMIT
		? updated
		: updated.slice(updated.length - LOG_TAIL_LIMIT);
}

function safeDiagnostic(value) {
	let diagnostic = String(value ?? '');

	for (const path of [temporaryRoot, sourceRoot, PROJECT_ROOT].filter(Boolean)) {
		diagnostic = diagnostic
			.replaceAll(path, '<redacted-path>')
			.replaceAll(path.replaceAll('\\', '/'), '<redacted-path>');
	}

	return diagnostic
		.replace(
			/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
			'<redacted-uuid>'
		)
		.replace(/\b[A-Za-z]:\\[^\r\n]*/g, '<redacted-path>')
		.replace(/\/(?:home|tmp|Users)\/[^\r\n]*/g, '<redacted-path>')
		.trim();
}

function printOwnedProcessDiagnostics(record) {
	if (!record) {
		return;
	}

	console.error(
		`[diagnostic] active step ${activeStep.number}/${TOTAL_STEPS}: ${activeStep.label}`
	);
	console.error(`[diagnostic] ${record.label} stdout (safe tail):`);
	console.error(safeDiagnostic(record.stdoutTail) || '<empty>');
	console.error(`[diagnostic] ${record.label} stderr (safe tail):`);
	console.error(safeDiagnostic(record.stderrTail) || '<empty>');
}

function abortReason() {
	return overallController.signal.reason instanceof Error
		? overallController.signal.reason
		: new Error('The clean-clone verification was aborted.');
}

function throwIfAborted() {
	if (overallController.signal.aborted) {
		throw abortReason();
	}
}

function delay(milliseconds) {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
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

function gitCommand(indexPath, args, encoding = 'utf8') {
	throwIfAborted();

	const result = spawnSync(
		'git',
		[
			'-c',
			`safe.directory=${PROJECT_ROOT.replaceAll('\\', '/')}`,
			'-C',
			PROJECT_ROOT,
			...args
		],
		{
			encoding,
			env: {
				...process.env,
				GIT_INDEX_FILE: indexPath
			},
			maxBuffer: 16 * 1024 * 1024,
			shell: false,
			stdio: ['ignore', 'pipe', 'pipe'],
			timeout: GIT_TIMEOUT_MS,
			windowsHide: true
		}
	);

	if (result.error) {
		throw new Error(
			`Git ${args[0]} failed (${result.error.name}${
				result.error.code ? `; code ${result.error.code}` : ''
			}).`
		);
	}

	if (result.status !== 0) {
		const stderr = Buffer.isBuffer(result.stderr)
			? result.stderr.toString('utf8')
			: String(result.stderr ?? '');
		throw new Error(
			`Git ${args[0]} exited with code ${result.status}: ${
				stderr.trim() || '<no diagnostic>'
			}`
		);
	}

	return result.stdout;
}

function isInstructionPath(repositoryPath) {
	const normalized = repositoryPath.replaceAll('\\', '/');
	const lower = normalized.toLowerCase();
	const name = lower.split('/').at(-1);

	return name === 'agents.md' || name === 'project_requirements.md';
}

function isForbiddenCandidatePath(repositoryPath) {
	const normalized = repositoryPath.replaceAll('\\', '/');
	const lower = normalized.toLowerCase();
	const segments = lower.split('/');
	const name = segments.at(-1) ?? '';

	if (
		segments.includes('.git') ||
		segments.includes('node_modules') ||
		segments.includes('.svelte-kit') ||
		segments.includes('build')
	) {
		return true;
	}

	if (
		lower === '.env' ||
		(lower.startsWith('.env.') && lower !== '.env.example')
	) {
		return true;
	}

	if (
		lower.endsWith('.db') ||
		lower.endsWith('.db-shm') ||
		lower.endsWith('.db-wal') ||
		lower.endsWith('.sqlite') ||
		lower.endsWith('.sqlite3')
	) {
		return true;
	}

	if (lower.startsWith('data/') && lower !== 'data/.gitkeep') {
		return true;
	}

	if (
		lower.startsWith('storage/audio/') &&
		lower !== 'storage/audio/.gitkeep'
	) {
		return true;
	}

	return /\.(?:db|db-wal|db-shm|sqlite|sqlite3|sqlite-wal|sqlite-shm)$/i.test(
		name
	);
}

async function releaseCandidatePaths(indexPath) {
	gitCommand(indexPath, ['read-tree', 'HEAD']);
	gitCommand(indexPath, ['add', '-A', '--', '.']);
	const output = gitCommand(indexPath, ['ls-files', '-z'], null);
	const candidates = output
		.toString('utf8')
		.split('\0')
		.filter(Boolean);
	const instructionPaths = candidates.filter(isInstructionPath);
	const forbiddenPaths = candidates.filter(isForbiddenCandidatePath);
	const included = candidates.filter(
		(repositoryPath) =>
			!isInstructionPath(repositoryPath) &&
			!isForbiddenCandidatePath(repositoryPath)
	);

	assert(included.length > 0, 'The alternate Git index contained no release source.');
	assert(
		forbiddenPaths.length === 0,
		`The release candidate contains ${forbiddenPaths.length} forbidden runtime, dependency, build, environment, or database path(s).`
	);

	if (instructionPaths.length > 0) {
		console.log(
			`[candidate] excluded ${instructionPaths.length} local instruction file(s)`
		);
	}

	return included;
}

function containedPath(root, repositoryPath) {
	const resolvedPath = resolve(root, ...repositoryPath.split('/'));
	const pathFromRoot = relative(root, resolvedPath);

	assert(
		pathFromRoot !== '..' &&
			!pathFromRoot.startsWith(`..${sep}`) &&
			!isAbsolute(pathFromRoot),
		'The alternate Git index contained a path outside the project root.'
	);

	return resolvedPath;
}

async function copyReleaseCandidate(repositoryPaths, destinationRoot) {
	for (const repositoryPath of repositoryPaths) {
		throwIfAborted();

		const sourcePath = containedPath(PROJECT_ROOT, repositoryPath);
		const destinationPath = containedPath(destinationRoot, repositoryPath);
		const sourceStat = await lstat(sourcePath);

		assert(
			sourceStat.isFile() && !sourceStat.isSymbolicLink(),
			`Release source "${repositoryPath}" is not a regular file.`
		);

		await mkdir(dirname(destinationPath), { recursive: true });
		await copyFile(sourcePath, destinationPath);
	}

	for (const requiredPath of [
		'package.json',
		'package-lock.json',
		'drizzle.config.ts',
		'svelte.config.js'
	]) {
		assert(
			existsSync(join(destinationRoot, requiredPath)),
			`The release candidate omitted ${requiredPath}.`
		);
	}

	assert(
		!existsSync(join(destinationRoot, 'node_modules')) &&
			!existsSync(join(destinationRoot, '.git')),
		'The clean source unexpectedly contained dependencies or Git metadata.'
	);
}

function createOwnedProcess(command, args, options, label) {
	const child = spawn(command, args, {
		...options,
		detached: true,
		shell: false,
		stdio: ['ignore', 'pipe', 'pipe'],
		windowsHide: true
	});
	const record = {
		child,
		closed: false,
		closePromise: undefined,
		label,
		spawnError: undefined,
		stderrTail: '',
		stdoutTail: ''
	};

	child.stdout.on('data', (chunk) => {
		record.stdoutTail = updateTail(record.stdoutTail, chunk.toString());
	});
	child.stderr.on('data', (chunk) => {
		record.stderrTail = updateTail(record.stderrTail, chunk.toString());
	});
	child.once('error', (error) => {
		record.spawnError = error;
	});
	record.closePromise = new Promise((resolveClose) => {
		child.once('close', (code, signal) => {
			record.closed = true;
			resolveClose({ code, signal });
		});
	});

	return record;
}

function closeOwnedStreams(record) {
	for (const stream of [record?.child.stdout, record?.child.stderr]) {
		if (stream && !stream.closed && !stream.destroyed) {
			stream.destroy();
		}
	}
}

async function waitForOwnedClose(record, milliseconds) {
	if (record.closed) {
		return true;
	}

	let timeout;

	try {
		return await Promise.race([
			record.closePromise.then(() => true),
			new Promise((resolveWait) => {
				timeout = setTimeout(() => resolveWait(false), milliseconds);
			})
		]);
	} finally {
		clearTimeout(timeout);
	}
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

function terminateWindowsProcessTree(pid) {
	const result = spawnSync(
		'taskkill.exe',
		['/PID', String(pid), '/T', '/F'],
		{
			shell: false,
			stdio: 'ignore',
			timeout: SHUTDOWN_TIMEOUT_MS,
			windowsHide: true
		}
	);

	if (result.error && isProcessAlive(pid)) {
		throw new Error(
			`Windows could not terminate owned process ${pid} (${result.error.name}${
				result.error.code ? `; code ${result.error.code}` : ''
			}).`
		);
	}

	if (result.status !== 0 && isProcessAlive(pid)) {
		throw new Error(
			`Windows taskkill returned code ${result.status ?? 'unknown'} for owned process ${pid}.`
		);
	}
}

function signalOwnedProcess(record, force) {
	const pid = record.child.pid;

	if (!pid || record.closed || !isProcessAlive(pid)) {
		return;
	}

	if (process.platform === 'win32') {
		terminateWindowsProcessTree(pid);
		return;
	}

	const signal = force ? 'SIGKILL' : 'SIGTERM';

	try {
		process.kill(-pid, signal);
	} catch {
		record.child.kill(signal);
	}
}

async function stopOwnedProcess(record) {
	if (!record || record.closed) {
		return;
	}

	let terminationError;

	try {
		signalOwnedProcess(record, false);
	} catch (error) {
		terminationError = error;

		try {
			record.child.kill();
		} catch {
			// The postconditions below determine whether cleanup succeeded.
		}
	}

	let closed = await waitForOwnedClose(record, SHUTDOWN_TIMEOUT_MS);

	if (!closed || isProcessAlive(record.child.pid)) {
		closeOwnedStreams(record);

		try {
			signalOwnedProcess(record, true);
		} catch (error) {
			terminationError ??= error;
		}

		closed = await waitForOwnedClose(record, SHUTDOWN_TIMEOUT_MS);
	}

	if (!closed && !isProcessAlive(record.child.pid)) {
		closeOwnedStreams(record);
		closed = await waitForOwnedClose(record, SHUTDOWN_TIMEOUT_MS);
	}

	assert(
		closed && !isProcessAlive(record.child.pid),
		`Owned process "${record.label}" did not stop.`
	);

	if (terminationError) {
		throw terminationError;
	}
}

async function runOwnedCommand(command, args, options) {
	throwIfAborted();
	assert(!activeCommand, 'Another release command is already active.');

	const record = createOwnedProcess(
		command,
		args,
		{
			cwd: options.cwd,
			env: options.env
		},
		options.label
	);
	activeCommand = record;
	let timeout;
	let onAbort;
	let progressTimer;

	try {
		const startedAt = Date.now();
		progressTimer = setInterval(() => {
			console.log(
				`[step ${activeStep.number}/${TOTAL_STEPS}] still running (${Math.floor(
					(Date.now() - startedAt) / 1000
				)}s)`
			);
		}, 30_000);
		const interruption = new Promise((resolveInterruption) => {
			onAbort = () => {
				resolveInterruption({
					kind: 'interrupted',
					error: abortReason()
				});
			};
			overallController.signal.addEventListener('abort', onAbort, {
				once: true
			});

			if (overallController.signal.aborted) {
				onAbort();
			}

			timeout = setTimeout(() => {
				resolveInterruption({
					kind: 'interrupted',
					error: new Error(
						`${options.label} exceeded its ${Math.ceil(options.timeoutMs / 1000)}-second timeout.`
					)
				});
			}, options.timeoutMs);
		});
		const outcome = await Promise.race([
			record.closePromise.then((result) => ({
				kind: 'closed',
				result
			})),
			interruption
		]);

		if (outcome.kind === 'interrupted') {
			printOwnedProcessDiagnostics(record);

			try {
				await stopOwnedProcess(record);
			} catch (cleanupError) {
				throw new AggregateError(
					[outcome.error, cleanupError],
					`${options.label} timed out and its process cleanup failed.`
				);
			}

			throw outcome.error;
		}

		if (record.spawnError) {
			printOwnedProcessDiagnostics(record);
			throw new Error(
				`${options.label} could not start (${record.spawnError.name}${
					record.spawnError.code ? `; code ${record.spawnError.code}` : ''
				}).`
			);
		}

		if (outcome.result.code !== 0) {
			printOwnedProcessDiagnostics(record);
			throw new Error(
				`${options.label} exited with code ${
					outcome.result.code ?? 'unknown'
				}${
					outcome.result.signal ? ` after ${outcome.result.signal}` : ''
				}.`
			);
		}
	} finally {
		clearTimeout(timeout);
		clearInterval(progressTimer);

		if (onAbort) {
			overallController.signal.removeEventListener('abort', onAbort);
		}

		if (record.closed) {
			activeCommand = undefined;
		}
	}
}

function npmInvocation(args) {
	const configuredNpmPath = process.env.npm_execpath;

	if (configuredNpmPath) {
		const npmPath = isAbsolute(configuredNpmPath)
			? configuredNpmPath
			: resolve(PROJECT_ROOT, configuredNpmPath);

		if (existsSync(npmPath)) {
			return {
				command: process.execPath,
				args: [npmPath, ...args]
			};
		}
	}

	if (process.platform === 'win32') {
		return {
			command: process.env.ComSpec || 'cmd.exe',
			args: ['/d', '/s', '/c', ['npm.cmd', ...args].join(' ')]
		};
	}

	return {
		command: 'npm',
		args
	};
}

async function runNpm(args, label, timeoutMs, environment) {
	const invocation = npmInvocation(args);
	console.log(`[verify] ${label}`);
	await runOwnedCommand(invocation.command, invocation.args, {
		cwd: sourceRoot,
		env: environment,
		label,
		timeoutMs
	});
}

async function reservePort() {
	return new Promise((resolvePort, reject) => {
		const server = createServer();

		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();

			if (!address || typeof address === 'string') {
				server.close();
				reject(new Error('Unable to reserve an isolated release-check port.'));
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

function canConnect(port) {
	return new Promise((resolveConnection) => {
		const socket = connect({ host: '127.0.0.1', port });
		let finished = false;

		function finish(connected) {
			if (finished) {
				return;
			}

			finished = true;
			socket.destroy();
			resolveConnection(connected);
		}

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

		await delay(150);
	} while (Date.now() < deadline);

	throw new Error(`The release-check port ${port} is still accepting connections.`);
}

function normalizeHeaders(headers) {
	const normalized = new Map();

	for (const [name, value] of Object.entries(headers)) {
		normalized.set(
			name.toLowerCase(),
			Array.isArray(value) ? value.join(', ') : String(value ?? '')
		);
	}

	return normalized;
}

function requestPage(baseUrl, path, timeoutMs = REQUEST_TIMEOUT_MS) {
	throwIfAborted();
	const url = new URL(path, baseUrl);

	return new Promise((resolveResponse, rejectResponse) => {
		const chunks = [];
		let clientRequest;
		let clientResponse;
		let completed = false;
		let totalBytes = 0;
		const timeout = setTimeout(() => {
			const error = new Error(
				`HTTP request to ${url.pathname} exceeded ${Math.ceil(timeoutMs / 1000)} seconds.`
			);
			clientResponse?.destroy(error);
			clientRequest?.destroy(error);
			finish(error);
		}, timeoutMs);

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
				rejectResponse(error);
			} else {
				resolveResponse(response);
			}
		}

		function onAbort() {
			const error = abortReason();
			clientResponse?.destroy(error);
			clientRequest?.destroy(error);
			finish(error);
		}

		clientRequest = httpRequest(
			{
				agent: httpAgent,
				headers: {
					Accept: 'text/html',
					Connection: 'close'
				},
				host: url.hostname,
				method: 'GET',
				path: `${url.pathname}${url.search}`,
				port: url.port,
				protocol: url.protocol
			},
			(incomingResponse) => {
				clientResponse = incomingResponse;
				activeHttpResponses.add(clientResponse);
				clientResponse.on('data', (chunk) => {
					totalBytes += chunk.length;

					if (totalBytes > 5 * 1024 * 1024) {
						clientResponse.destroy(
							new Error(`HTTP response from ${url.pathname} exceeded 5 MiB.`)
						);
						return;
					}

					chunks.push(chunk);
				});
				clientResponse.once('aborted', () => {
					finish(
						new Error(`HTTP response from ${url.pathname} was aborted.`)
					);
				});
				clientResponse.once('error', (error) => finish(error));
				clientResponse.once('close', () => {
					if (!completed && !clientResponse.complete) {
						finish(
							new Error(
								`HTTP response from ${url.pathname} closed prematurely.`
							)
						);
					}
				});
				clientResponse.once('end', () => {
					finish(null, {
						body: Buffer.concat(chunks),
						headers: normalizeHeaders(clientResponse.headers),
						status: clientResponse.statusCode ?? 0
					});
				});
			}
		);

		activeHttpRequests.add(clientRequest);
		overallController.signal.addEventListener('abort', onAbort, { once: true });
		clientRequest.once('error', (error) => finish(error));
		clientRequest.end();
	});
}

function cancelActiveHttpOperations() {
	const error = new Error(
		'Clean-clone cleanup cancelled an active HTTP operation.'
	);

	for (const response of activeHttpResponses) {
		response.destroy(error);
	}

	for (const request of activeHttpRequests) {
		request.destroy(error);
	}

	activeHttpResponses.clear();
	activeHttpRequests.clear();
	httpAgent.destroy();
}

async function waitForServer(baseUrl) {
	const deadline = Date.now() + STARTUP_TIMEOUT_MS;
	let lastError;

	while (Date.now() < deadline) {
		throwIfAborted();

		if (serverProcess?.closed) {
			const outcome = await serverProcess.closePromise;
			throw new Error(
				`The production server exited during startup with code ${
					outcome.code ?? 'unknown'
				}.`
			);
		}

		try {
			const remaining = Math.max(1, deadline - Date.now());
			return await requestPage(
				baseUrl,
				'/',
				Math.min(REQUEST_TIMEOUT_MS, remaining)
			);
		} catch (error) {
			if (overallController.signal.aborted) {
				throw error;
			}

			lastError = error;
		}

		await delay(300);
	}

	throw new Error(
		`The production server did not respond within 45 seconds${
			lastError instanceof Error ? ` (${lastError.message})` : ''
		}.`
	);
}

function assertHealthyPage(response, path) {
	assert(response.status === 200, `GET ${path} returned ${response.status}.`);
	assert(response.body.length > 0, `GET ${path} returned an empty body.`);
	assert(
		(response.headers.get('content-type') ?? '')
			.toLowerCase()
			.includes('text/html'),
		`GET ${path} did not return HTML.`
	);
}

function readErrorCode(error) {
	if (typeof error !== 'object' || error === null || !('code' in error)) {
		return undefined;
	}

	return typeof error.code === 'string' || typeof error.code === 'number'
		? error.code
		: undefined;
}

function describeError(error) {
	if (error instanceof AggregateError) {
		return `${error.message} ${error.errors
			.map((nestedError) => `[${describeError(nestedError)}]`)
			.join(' ')}`;
	}

	return error instanceof Error ? error.message : String(error);
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

		console.error(
			`[cleanup] temporary-directory retry ${attempt}/${attempts} (code ${
				readErrorCode(lastError) ?? 'unknown'
			})`
		);

		if (attempt < attempts) {
			await delay(250);
		}
	}

	throw new Error(
		`The clean-clone temporary directory could not be removed after ${attempts} attempts (code ${
			readErrorCode(lastError) ?? 'unknown'
		}).`
	);
}

function isolatedEnvironment() {
	const environment = {
		...process.env,
		AUDIO_STORAGE_PATH: ISOLATED_AUDIO_STORAGE_PATH,
		BODY_SIZE_LIMIT: '3M',
		CI: '1',
		DATABASE_URL: ISOLATED_DATABASE_URL,
		INIT_CWD: sourceRoot,
		MAX_AUDIO_FILE_SIZE_MB: '2',
		NO_COLOR: '1',
		SESSION_COOKIE_NAME: 'clean_clone_session',
		SESSION_DURATION_DAYS: '1'
	};

	delete environment.HOST;
	delete environment.NODE_ENV;
	delete environment.ORIGIN;
	delete environment.PORT;

	return environment;
}

async function runReleaseVerification() {
	beginStep(1, 'creating temporary clone');
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
		realAudioRoot,
		realDatabase,
		realStateBefore
	};

	temporaryRoot = await mkdtemp(join(resolve(tmpdir()), TEMP_PREFIX));
	assert(
		isSafeTemporaryRoot(temporaryRoot),
		'The generated clean-clone root is outside the validated temporary parent.'
	);
	sourceRoot = join(temporaryRoot, 'source');
	const alternateIndex = join(temporaryRoot, 'candidate.index');
	await mkdir(sourceRoot, { recursive: true });
	completeStep(1);

	beginStep(2, 'copying tracked files');
	const repositoryPaths = await releaseCandidatePaths(alternateIndex);
	await copyReleaseCandidate(repositoryPaths, sourceRoot);
	console.log(
		`[candidate] copied ${repositoryPaths.length} release file(s) through an alternate Git index`
	);
	completeStep(2);

	const runtimeRoot = join(sourceRoot, '.release-runtime');
	const isolatedDatabase = join(runtimeRoot, 'app.db');
	const isolatedAudioRoot = join(runtimeRoot, 'audio');
	const environmentExample = join(sourceRoot, '.env.example');
	const isolatedEnvironmentFile = join(sourceRoot, '.env');
	const environment = isolatedEnvironment();

	beginStep(3, 'npm ci');
	await runNpm(
		['ci', '--include=dev', '--no-audit', '--no-fund'],
		'npm ci',
		INSTALL_TIMEOUT_MS,
		environment
	);
	completeStep(3);

	beginStep(4, 'environment creation');
	assert(
		existsSync(environmentExample),
		'The release candidate omitted .env.example.'
	);
	assert(
		!existsSync(isolatedEnvironmentFile),
		'The clean source unexpectedly contained a tracked .env file.'
	);
	await copyFile(environmentExample, isolatedEnvironmentFile);
	assert(
		(await readFile(environmentExample)).equals(
			await readFile(isolatedEnvironmentFile)
		),
		'.env.example could not be copied byte-for-byte to .env.'
	);
	await mkdir(isolatedAudioRoot, { recursive: true });
	assert(
		!existsSync(isolatedDatabase),
		'The isolated database was not fresh before migration.'
	);
	completeStep(4);

	beginStep(5, 'database migration');
	await runNpm(
		['run', 'db:migrate'],
		'fresh database migration',
		MIGRATION_TIMEOUT_MS,
		environment
	);
	const migratedDatabase = await stat(isolatedDatabase);
	assert(
		migratedDatabase.isFile() && migratedDatabase.size > 0,
		'Fresh migrations did not create the isolated database.'
	);
	completeStep(5);

	beginStep(6, 'npm run check');
	await runNpm(
		['run', 'check'],
		'type and Svelte checks',
		CHECK_TIMEOUT_MS,
		environment
	);
	completeStep(6);

	beginStep(7, 'npm run test');
	await runNpm(
		['run', 'test'],
		'unit tests',
		TEST_TIMEOUT_MS,
		environment
	);
	completeStep(7);

	beginStep(8, 'npm run build');
	await runNpm(
		['run', 'build'],
		'production build',
		BUILD_TIMEOUT_MS,
		environment
	);
	completeStep(8);

	beginStep(9, 'bounded server startup (45-second limit)');
	serverPort = await reservePort();
	const baseUrl = `http://127.0.0.1:${serverPort}`;
	serverProcess = createOwnedProcess(
		process.execPath,
		[join(sourceRoot, 'build', 'index.js')],
		{
			cwd: sourceRoot,
			env: {
				...environment,
				HOST: '127.0.0.1',
				NODE_ENV: 'production',
				ORIGIN: baseUrl,
				PORT: String(serverPort)
			}
		},
		'production adapter-node server'
	);
	console.log(`[server] probing production output on port ${serverPort}`);

	const homeResponse = await waitForServer(baseUrl);
	completeStep(9);

	beginStep(10, 'HTTP checks (10-second request limit)');
	assertHealthyPage(homeResponse, '/');
	assert(
		homeResponse.body.toString('utf8').includes('Discover community audio.'),
		'GET / did not render the expected home-page heading.'
	);
	const tracksResponse = await requestPage(baseUrl, '/tracks');
	assertHealthyPage(tracksResponse, '/tracks');
	assert(
		tracksResponse.body.toString('utf8').includes('Browse tracks') &&
			tracksResponse.body
				.toString('utf8')
				.includes('Search by title, artist, or description'),
		'GET /tracks did not render the expected public track browser.'
	);
	console.log('[server] GET / and GET /tracks returned complete HTML responses');

	assert(
		(await readdir(isolatedAudioRoot)).length === 0,
		'The clean-clone probes unexpectedly wrote to isolated audio storage.'
	);
	const realStateDuring = await realStateSnapshot(realDatabase, realAudioRoot);
	assert(
		snapshotsEqual(realStateBefore, realStateDuring),
		'The real database or audio storage changed during clean-clone verification.'
	);
	console.log('[isolation] real database and audio storage remained unchanged');
	completeStep(10);
}

async function cleanup() {
	const cleanupErrors = [];
	beginStep(11, 'server termination and owned-process cleanup');

	function recordCleanupError(step, error) {
		cleanupErrors.push(error);
		console.error(
			`[cleanup] ${step} failed (${error instanceof Error ? error.name : 'UnknownError'}${
				readErrorCode(error) === undefined
					? ''
					: `; code ${readErrorCode(error)}`
			}).`
		);
	}

	overallController.abort(
		new Error('Clean-clone verification entered final cleanup.')
	);

	try {
		cancelActiveHttpOperations();
	} catch (error) {
		recordCleanupError('HTTP connection close', error);
	}

	if (activeCommand) {
		try {
			await stopOwnedProcess(activeCommand);
		} catch (error) {
			recordCleanupError(`owned command "${activeCommand.label}" stop`, error);
		}
	}

	if (serverProcess) {
		try {
			await stopOwnedProcess(serverProcess);
		} catch (error) {
			recordCleanupError('production server stop', error);
		}
	}

	let portReleased = true;

	if (serverPort) {
		try {
			await waitForPortRelease(serverPort);
		} catch (error) {
			portReleased = false;
			recordCleanupError(`port ${serverPort} postcondition`, error);
		}
	}

	const ownedProcesses = [activeCommand, serverProcess].filter(Boolean);
	const processesStopped = ownedProcesses.every(
		(record) =>
			record.closed &&
			(!record.child.pid || !isProcessAlive(record.child.pid))
	);
	const streamsClosed = ownedProcesses.every((record) =>
		[record.child.stdout, record.child.stderr].every(
			(stream) => !stream || stream.closed || stream.destroyed
		)
	);

	if (!processesStopped) {
		recordCleanupError(
			'owned-process postcondition',
			new Error('At least one clean-clone child process is still active.')
		);
	}

	if (!streamsClosed) {
		for (const record of ownedProcesses) {
			closeOwnedStreams(record);
		}
		recordCleanupError(
			'owned-stream postcondition',
			new Error('At least one clean-clone child output stream remained open.')
		);
	}

	if (cleanupErrors.length === 0) {
		completeStep(11);
	}

	beginStep(12, 'temporary-directory cleanup');
	const cleanupErrorsBeforeTemporaryRemoval = cleanupErrors.length;

	if (temporaryRoot && existsSync(temporaryRoot)) {
		if (!processesStopped || !portReleased) {
			recordCleanupError(
				'temporary-directory removal safety gate',
				new Error(
					'Temporary removal was skipped because an owned process or port remained active.'
				)
			);
		} else {
			try {
				assert(
					isSafeTemporaryRoot(temporaryRoot),
					'Refusing to remove an unvalidated clean-clone directory.'
				);
				await removeTemporaryDirectoryWithRetry(temporaryRoot);
				assert(
					!existsSync(temporaryRoot),
					'The clean-clone temporary directory was not removed.'
				);
			} catch (error) {
				recordCleanupError('temporary-directory removal', error);
			}
		}
	}

	if (realStateForCleanup) {
		try {
			const realStateAfter = await realStateSnapshot(
				realStateForCleanup.realDatabase,
				realStateForCleanup.realAudioRoot
			);
			assert(
				snapshotsEqual(
					realStateForCleanup.realStateBefore,
					realStateAfter
				),
				'The real database or audio storage changed during clean-clone cleanup.'
			);
		} catch (error) {
			recordCleanupError('real database and audio postcondition', error);
		}
	}

	if (cleanupErrors.length === cleanupErrorsBeforeTemporaryRemoval) {
		completeStep(12);
	}

	if (cleanupErrors.length > 0) {
		throw new AggregateError(
			cleanupErrors,
			'Clean-clone verification cleanup failed.'
		);
	}

	console.log(
		'[cleanup] owned processes, HTTP, port, and temporary source were removed'
	);
}

let primaryError;
let verificationPassed = false;
const overallTimer = setTimeout(() => {
	overallController.abort(
		new Error(
			`Clean-clone verification exceeded its 14-minute execution limit during step ${activeStep.number}/${TOTAL_STEPS} (${activeStep.label}); one minute was reserved for bounded cleanup.`
		)
	);
}, VERIFICATION_TIMEOUT_MS);

try {
	await Promise.race([
		runReleaseVerification(),
		new Promise((_, reject) => {
			overallController.signal.addEventListener(
				'abort',
				() => reject(abortReason()),
				{ once: true }
			);
		})
	]);
	verificationPassed = true;
} catch (error) {
	primaryError = error;
	failedStep = { ...activeStep };

	if (activeCommand) {
		printOwnedProcessDiagnostics(activeCommand);
	} else if (serverProcess) {
		printOwnedProcessDiagnostics(serverProcess);
	}
} finally {
	clearTimeout(overallTimer);

	try {
		await cleanup();
	} catch (cleanupError) {
		failedStep ??= { ...activeStep };
		primaryError = primaryError
			? new AggregateError(
					[primaryError, cleanupError],
					'Clean-clone verification and cleanup both failed.'
				)
			: cleanupError;
	}
}

if (primaryError) {
	console.error(
		`[failure] active numbered step: ${failedStep?.number ?? activeStep.number}/${TOTAL_STEPS} (${failedStep?.label ?? activeStep.label})`
	);
	console.error(`[failure] ${describeError(primaryError)}`);
	process.exitCode = 1;
} else if (verificationPassed) {
	console.log('CLEAN_CLONE_VERIFICATION_PASSED=1');
	process.exitCode = 0;
}

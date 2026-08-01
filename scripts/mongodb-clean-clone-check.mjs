import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { MongoClientManager } from '../src/lib/server/mongodb/client.ts';
import {
	assertMongoTestDatabaseName,
	MONGODB_TEST_DATABASE_PREFIX,
	readMongoConfig
} from '../src/lib/server/mongodb/config.ts';
import { getMongoCollections } from '../src/lib/server/mongodb/collections.ts';
import { TRACK_PUBLIC_ID_COUNTER } from '../src/lib/server/mongodb/documents.ts';
import { safeMongoAggregateFingerprint } from './lib/mongodb-fingerprint.mjs';

const COMMAND_TIMEOUT_MS = 10 * 60_000;
const STARTUP_TIMEOUT_MS = 45_000;
const SHUTDOWN_TIMEOUT_MS = 8_000;
const TEMP_PREFIX = 'audio-library-mongodb-clean-';
const sourceRoot = resolve('.');

function ownedName(base, developmentName) {
	const suffix = `_clean_${randomBytes(6).toString('hex')}`;
	const name = `${base.slice(0, 63 - suffix.length)}${suffix}`;
	assertMongoTestDatabaseName(name, developmentName);
	return name;
}

function safeTemporaryRoot(path) {
	return dirname(resolve(path)) === resolve(tmpdir()) &&
		resolve(path).split(/[\\/]/).at(-1)?.startsWith(TEMP_PREFIX);
}

function releaseCandidatePaths() {
	const result = spawnSync(
		'git',
		[
			'-c',
			`safe.directory=${sourceRoot.replaceAll('\\', '/')}`,
			'ls-files',
			'--cached',
			'--others',
			'--exclude-standard',
			'-z'
		],
		{ cwd: sourceRoot, encoding: 'buffer', timeout: 30_000 }
	);
	assert.equal(result.status, 0, 'Unable to enumerate the release candidate.');
	return result.stdout
		.toString('utf8')
		.split('\0')
		.filter(Boolean)
		.filter((path) => path !== '.env');
}

async function copyCandidate(paths, destination) {
	for (const path of paths) {
		const source = resolve(sourceRoot, path);
		if (!existsSync(source)) continue;
		const target = resolve(destination, path);
		assert.ok(relative(sourceRoot, source) && !relative(sourceRoot, source).startsWith('..'));
		await mkdir(dirname(target), { recursive: true });
		await copyFile(source, target);
	}
}

function runNode(args, options) {
	return new Promise((resolveRun, rejectRun) => {
		console.log(`[verify] ${options.label}`);
		const child = spawn(process.execPath, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: options.stdio ?? 'inherit',
			windowsHide: true
		});
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			rejectRun(new Error(`${options.label} exceeded its bounded timeout.`));
		}, options.timeoutMs ?? COMMAND_TIMEOUT_MS);
		child.once('error', rejectRun);
		child.once('close', (code, signal) => {
			clearTimeout(timer);
			if (code === 0) resolveRun();
			else rejectRun(new Error(`${options.label} failed (exit ${code}, signal ${signal ?? 'none'}).`));
		});
	});
}

function npmArgs(...args) {
	const cli = process.env.npm_execpath;
	assert.ok(cli && existsSync(cli), 'npm CLI path is unavailable.');
	return [cli, ...args];
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
				else if (port === null) rejectPort(new Error('Unable to reserve a port.'));
				else resolvePort(port);
			});
		});
	});
}

async function portReleased(port) {
	return new Promise((resolveReleased) => {
		const server = createServer();
		server.unref();
		server.once('error', () => resolveReleased(false));
		server.listen(port, '127.0.0.1', () => server.close(() => resolveReleased(true)));
	});
}

async function waitForServer(baseUrl, child) {
	const deadline = Date.now() + STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error('Production server exited during startup.');
		try {
			const live = await fetch(`${baseUrl}/api/health/live`, {
				signal: AbortSignal.timeout(1_500)
			});
			const ready = await fetch(`${baseUrl}/api/health/ready`, {
				signal: AbortSignal.timeout(6_000)
			});
			const application = await fetch(baseUrl, {
				signal: AbortSignal.timeout(1_500)
			});
			if (
				live.status === 200 &&
				JSON.stringify(await live.json()) === JSON.stringify({ status: 'ok' }) &&
				ready.status === 200 &&
				JSON.stringify(await ready.json()) === JSON.stringify({ status: 'ready' }) &&
				application.status === 200 &&
				(await application.text()).length > 0
			) return;
		} catch {
			// Retry until the bounded deadline.
		}
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
	}
	throw new Error('Production server did not become ready.');
}

async function stopChild(child, closePromise) {
	if (!child || child.exitCode !== null) return;
	child.kill();
	await Promise.race([
		closePromise,
		new Promise((resolveDelay) => setTimeout(resolveDelay, SHUTDOWN_TIMEOUT_MS))
	]);
	if (child.exitCode === null) {
		child.kill('SIGKILL');
		await Promise.race([
			closePromise,
			new Promise((resolveDelay) => setTimeout(resolveDelay, SHUTDOWN_TIMEOUT_MS))
		]);
	}
	assert.ok(child.exitCode !== null || child.signalCode !== null);
}

async function deadReferenceAudit(root) {
	const forbidden = [
		['sql', 'ite'].join(''),
		['driz', 'zle'].join(''),
		['DATABASE', 'URL'].join('_'),
		['DATABASE', 'BACKEND'].join('_'),
		['app', 'db'].join('.')
	];
	const relevant = new Set(['.js', '.mjs', '.ts', '.svelte', '.json']);
	const violations = [];
	async function visit(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (['node_modules', '.git', '.svelte-kit', 'build'].includes(entry.name)) continue;
			const path = join(directory, entry.name);
			if (entry.isDirectory()) await visit(path);
			else if (
				entry.isFile() &&
				(relevant.has(entry.name.slice(entry.name.lastIndexOf('.'))) ||
					entry.name === '.env.example')
			) {
				const text = (await readFile(path, 'utf8')).toLowerCase();
				if (forbidden.some((term) => text.includes(term.toLowerCase()))) {
					violations.push(relative(root, path));
				}
			}
		}
	}
	await visit(root);
	assert.deepEqual(violations, [], 'Active clean source contains removed persistence references.');
}

const config = readMongoConfig(process.env);
const ownedDatabase = ownedName(config.testDatabaseName, config.databaseName);
const manager = new MongoClientManager(config);
let initialTestDatabases;
let realBefore;
let temporaryRoot;
let cleanRoot;
let audioRoot;
let server;
let serverClosePromise = Promise.resolve();
let serverPort;
let primaryFailure;
const cleanupFailures = [];

try {
	const client = await manager.connect();
	const listed = await client.db('admin').admin().listDatabases({ nameOnly: true });
	initialTestDatabases = listed.databases
		.map(({ name }) => name)
		.filter((name) => name.startsWith(MONGODB_TEST_DATABASE_PREFIX))
		.sort();
	assert.equal(initialTestDatabases.includes(ownedDatabase), false);
	const collections = getMongoCollections(client.db(config.databaseName));
	realBefore = {
		fingerprint: await safeMongoAggregateFingerprint(collections),
		counter: await collections.counters.findOne(
			{ _id: TRACK_PUBLIC_ID_COUNTER },
			{ projection: { _id: 0, value: 1 }, timeoutMS: 5_000 }
		)
	};
	await manager.close(true);

	temporaryRoot = await mkdtemp(join(resolve(tmpdir()), TEMP_PREFIX));
	assert.ok(safeTemporaryRoot(temporaryRoot));
	cleanRoot = join(temporaryRoot, 'source');
	audioRoot = join(temporaryRoot, 'audio');
	await mkdir(cleanRoot, { recursive: true });
	await mkdir(audioRoot, { recursive: true });
	await copyCandidate(releaseCandidatePaths(), cleanRoot);
	assert.equal(existsSync(join(cleanRoot, '.env')), false);
	assert.equal(
		existsSync(join(cleanRoot, 'data', ['app', 'db'].join('.'))),
		false
	);

	const environment = {
		...process.env,
		AUDIO_STORAGE_PATH: audioRoot,
		CI: '1',
		MONGODB_DB_NAME: ownedDatabase,
		MONGODB_TEST_DB_NAME: config.testDatabaseName,
		NO_COLOR: '1',
		SESSION_COOKIE_NAME: `clean_${randomBytes(4).toString('hex')}`
	};
	delete environment.PORT;
	delete environment.ORIGIN;

	await runNode(npmArgs('ci', '--include=dev', '--no-audit', '--no-fund'), {
		cwd: cleanRoot,
		env: environment,
		label: 'npm ci'
	});
	await runNode(npmArgs('run', 'check'), { cwd: cleanRoot, env: environment, label: 'npm run check' });
	await runNode(npmArgs('run', 'test'), { cwd: cleanRoot, env: environment, label: 'npm test' });
	await runNode(npmArgs('run', 'db:mongodb:init'), { cwd: cleanRoot, env: environment, label: 'MongoDB explicit initialization' });
	await runNode(npmArgs('run', 'db:mongodb:verify'), { cwd: cleanRoot, env: environment, label: 'MongoDB read-only verification' });
	await runNode(npmArgs('run', 'test:mongodb:users'), { cwd: cleanRoot, env: environment, label: 'MongoDB users integration' });
	await runNode(npmArgs('run', 'test:mongodb:auth'), { cwd: cleanRoot, env: environment, label: 'MongoDB auth integration' });
	await runNode(npmArgs('run', 'test:mongodb:tracks'), { cwd: cleanRoot, env: environment, label: 'MongoDB tracks integration' });
	await runNode(npmArgs('run', 'test:mongodb:queries'), { cwd: cleanRoot, env: environment, label: 'MongoDB queries integration' });
	await runNode(npmArgs('run', 'test:mongodb:playlists'), { cwd: cleanRoot, env: environment, label: 'MongoDB playlists integration' });
	await runNode(npmArgs('run', 'test:mongodb:regression'), { cwd: cleanRoot, env: environment, label: 'MongoDB regression' });
	await runNode(npmArgs('run', 'test:mongodb:recovery'), { cwd: cleanRoot, env: environment, label: 'Synthetic MongoDB/audio recovery integration' });
	await runNode(npmArgs('run', 'build'), { cwd: cleanRoot, env: environment, label: 'npm run build' });
	await deadReferenceAudit(cleanRoot);

	serverPort = await reservePort();
	const baseUrl = `http://127.0.0.1:${serverPort}`;
	server = spawn(process.execPath, [
		'--experimental-strip-types',
		join(cleanRoot, 'scripts', 'start-production.mjs')
	], {
		cwd: cleanRoot,
		env: {
			...environment,
			HOST: '127.0.0.1',
			NODE_ENV: 'production',
			ORIGIN: `https://127.0.0.1:${serverPort}`,
			PORT: String(serverPort)
		},
		stdio: 'ignore',
		windowsHide: true
	});
	serverClosePromise = new Promise((resolveClose) => {
		server.once('close', (code, signal) => resolveClose({ code, signal }));
	});
	await waitForServer(baseUrl, server);
} catch (error) {
	primaryFailure = error;
} finally {
	try {
		await stopChild(server, serverClosePromise);
	} catch (error) {
		cleanupFailures.push(error);
	}
	if (serverPort) {
		try {
			assert.equal(await portReleased(serverPort), true);
		} catch (error) {
			cleanupFailures.push(error);
		}
	}
	try {
		const cleanupManager = new MongoClientManager(config);
		try {
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
			const collections = getMongoCollections(client.db(config.databaseName));
			assert.equal(await safeMongoAggregateFingerprint(collections), realBefore.fingerprint);
			assert.deepEqual(
				await collections.counters.findOne(
					{ _id: TRACK_PUBLIC_ID_COUNTER },
					{ projection: { _id: 0, value: 1 }, timeoutMS: 5_000 }
				),
				realBefore.counter
			);
		} finally {
			await cleanupManager.close(true);
		}
	} catch (error) {
		cleanupFailures.push(error);
	}
	if (temporaryRoot && existsSync(temporaryRoot)) {
		try {
			assert.ok(safeTemporaryRoot(temporaryRoot));
			await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
			assert.equal(existsSync(temporaryRoot), false);
		} catch (error) {
			cleanupFailures.push(error);
		}
	}
	await manager.close(true).catch((error) => cleanupFailures.push(error));
}

if (primaryFailure && cleanupFailures.length > 0) {
	throw new AggregateError([primaryFailure, ...cleanupFailures], 'Clean-copy verification and cleanup failed.');
}
if (primaryFailure) throw primaryFailure;
if (cleanupFailures.length > 0) {
	throw new AggregateError(cleanupFailures, 'Clean-copy cleanup failed.');
}
console.log('MONGODB_ONLY_CLEAN_COPY_PASSED=1');
console.log('PASS: dependencies, checks, tests, build, production probe, and dead-reference audit.');
console.log('PASS: exact owned database, audio, process, port, clients, listeners, and timers cleaned.');

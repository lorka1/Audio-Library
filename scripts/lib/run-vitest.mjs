import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { createSyntheticApplicationEnvironment } from './synthetic-app-environment.mjs';

const require = createRequire(import.meta.url);
const VITEST_TEMP_PREFIX = 'audio-library-vitest-';

function isOwnedVitestRoot(path) {
	const absolute = resolve(path);
	return (
		dirname(absolute) === resolve(tmpdir()) &&
		basename(absolute).startsWith(VITEST_TEMP_PREFIX)
	);
}

async function createOwnedVitestRoot() {
	return mkdtemp(join(tmpdir(), VITEST_TEMP_PREFIX));
}

async function removeOwnedVitestRoot(root) {
	if (!isOwnedVitestRoot(root)) {
		throw new Error('Refusing to remove an unowned Vitest configuration root.');
	}
	await rm(root, { recursive: true, force: true });
}

export function resolveLocalVitestEntry() {
	return resolve(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
}

export function buildVitestProcessSpec(vitestArguments, options = {}) {
	if (!Array.isArray(vitestArguments) ||
		vitestArguments.some((argument) => typeof argument !== 'string')) {
		throw new TypeError('Vitest arguments must be an array of strings.');
	}
	const executable = options.nodeExecutable ?? process.execPath;
	const vitestEntry = options.vitestEntry ?? resolveLocalVitestEntry();
	const configurationRoot = resolve(
		options.configurationRoot ??
			join(tmpdir(), `${VITEST_TEMP_PREFIX}config-${process.pid}`)
	);
	if (!isAbsolute(executable) || !isAbsolute(vitestEntry)) {
		throw new Error('Local test executables must resolve to absolute paths.');
	}
	return {
		executable,
		arguments: [vitestEntry, ...vitestArguments],
		environment: createSyntheticApplicationEnvironment(
			{
				AUDIO_STORAGE_PATH: resolve(configurationRoot, 'audio'),
				...(options.environmentOverrides ?? {})
			},
			options.parentEnvironment ?? process.env
		),
		configurationRoot
	};
}

export async function runVitest(vitestArguments, options = {}) {
	const makeTemporaryRoot = options.makeTemporaryRoot ?? createOwnedVitestRoot;
	const cleanupTemporaryRoot = options.cleanupTemporaryRoot ?? removeOwnedVitestRoot;
	let ownedRoot;
	let ownsRoot = false;
	let child;
	let handleSigint;
	let handleSigterm;
	let result;
	let primaryFailure;
	try {
		ownedRoot = await makeTemporaryRoot();
		if (!isOwnedVitestRoot(ownedRoot)) {
			throw new Error('Vitest configuration root is not an owned temporary directory.');
		}
		ownsRoot = true;
		const specification = buildVitestProcessSpec(vitestArguments, {
			...options,
			configurationRoot: ownedRoot
		});
		const spawnProcess = options.spawnProcess ?? spawn;
		child = spawnProcess(specification.executable, specification.arguments, {
			env: specification.environment,
			shell: false,
			stdio: 'inherit',
			windowsHide: true
		});

		const forwardSignal = (signal) => {
			if (child.exitCode === null && child.signalCode === null) child.kill(signal);
		};
		handleSigint = () => forwardSignal('SIGINT');
		handleSigterm = () => forwardSignal('SIGTERM');
		process.once('SIGINT', handleSigint);
		process.once('SIGTERM', handleSigterm);

		result = await new Promise((resolveCode, rejectRun) => {
			let settled = false;
			child.once('error', () => {
				if (settled) return;
				settled = true;
				rejectRun(new Error('Unable to start the local Vitest process.'));
			});
			child.once('close', (code, signal) => {
				if (settled) return;
				settled = true;
				if (code !== null) resolveCode(code);
				else resolveCode(signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
			});
		});
	} catch (error) {
		primaryFailure = error;
	} finally {
		if (handleSigint) process.removeListener('SIGINT', handleSigint);
		if (handleSigterm) process.removeListener('SIGTERM', handleSigterm);
		if (child && child.exitCode === null && child.signalCode === null) {
			child.kill('SIGTERM');
		}
		if (ownsRoot) {
			try {
				await cleanupTemporaryRoot(ownedRoot);
			} catch {
				if (!primaryFailure) {
					primaryFailure = new Error('Unable to remove the owned Vitest configuration root.');
				}
			}
		}
	}

	if (primaryFailure) throw primaryFailure;
	return result;
}

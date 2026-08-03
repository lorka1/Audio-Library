import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createSyntheticApplicationEnvironment } from './synthetic-app-environment.mjs';

export const DIRECT_IMPORT_PROBE_TARGETS = Object.freeze([
	'playlist-validation',
	'playlist-repository'
]);
const OUTPUT_LIMIT = 4_096;

export function buildDirectImportProbeEnvironment(
	ownedRoot,
	overrides = {},
	parentEnvironment = process.env
) {
	return createSyntheticApplicationEnvironment({
		AUDIO_STORAGE_PATH: join(ownedRoot, 'audio'),
		PLAYLIST_IMAGE_STORAGE_PATH: join(ownedRoot, 'playlist-images'),
		...overrides
	}, parentEnvironment);
}

function appendBounded(current, chunk) {
	return `${current}${String(chunk)}`.slice(-OUTPUT_LIMIT);
}

export async function runDirectModuleImportProbe(
	target,
	{
		cwd = process.cwd(),
		environmentOverrides = {},
		parentEnvironment = process.env,
		timeoutMs = 30_000,
		spawnChild = spawn
	} = {}
) {
	if (!DIRECT_IMPORT_PROBE_TARGETS.includes(target)) {
		throw new Error('Unsupported direct import probe target.');
	}
	if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
		throw new Error('Direct import probe timeout is invalid.');
	}

	const ownedRoot = await mkdtemp(join(tmpdir(), 'audio-library-import-probe-'));
	try {
		const environment = buildDirectImportProbeEnvironment(
			ownedRoot,
			environmentOverrides,
			parentEnvironment
		);
		const child = spawnChild(
			process.execPath,
			[
				'--experimental-strip-types',
				resolve(cwd, 'scripts/direct-module-import-probe.mjs'),
				target
			],
			{
				cwd: resolve(cwd),
				env: environment,
				shell: false,
				stdio: ['ignore', 'pipe', 'pipe'],
				windowsHide: true
			}
		);

		let stdout = '';
		let stderr = '';
		let timedOut = false;
		const onStdout = (chunk) => { stdout = appendBounded(stdout, chunk); };
		const onStderr = (chunk) => { stderr = appendBounded(stderr, chunk); };
		child.stdout?.on('data', onStdout);
		child.stderr?.on('data', onStderr);

		const result = await new Promise((resolveProbe, rejectProbe) => {
			let timer = setTimeout(() => {
				timedOut = true;
				child.kill('SIGKILL');
			}, timeoutMs);

			const cleanup = () => {
				if (timer) clearTimeout(timer);
				timer = undefined;
				child.removeListener('error', onError);
				child.removeListener('close', onClose);
				child.stdout?.removeListener('data', onStdout);
				child.stderr?.removeListener('data', onStderr);
			};
			const onError = () => {
				cleanup();
				rejectProbe(new Error(`Direct import probe could not start for ${target}.`));
			};
			const onClose = (code, signal) => {
				cleanup();
				if (timedOut) {
					rejectProbe(new Error(`Direct import probe timed out for ${target}.`));
					return;
				}
				if (code !== 0) {
					rejectProbe(new Error(
						`Direct import probe failed for ${target} (code ${code ?? 'none'}, signal ${signal ?? 'none'}).`
					));
					return;
				}
				const marker = `DIRECT_IMPORT_PROBE_PASSED=${target}`;
				if (!stdout.split(/\r?\n/).includes(marker)) {
					rejectProbe(new Error(`Direct import probe returned no success marker for ${target}.`));
					return;
				}
				resolveProbe({ target, marker, stderrPresent: Boolean(stderr.trim()) });
			};

			child.once('error', onError);
			child.once('close', onClose);
		});
		return result;
	} finally {
		await rm(ownedRoot, { recursive: true, force: true });
	}
}

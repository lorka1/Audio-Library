import { EventEmitter } from 'node:events';
import { access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PLAYLIST_IMAGE_TEST_FILES } from './playlist-image-test-files.mjs';
import {
	buildVitestProcessSpec,
	resolveLocalVitestEntry,
	runVitest
} from './run-vitest.mjs';

function ownedRoot(label) {
	return join(tmpdir(), `audio-library-vitest-${label}`);
}

describe('shared Vitest process runner', () => {
	it('builds a complete deterministic child environment without mutating parents', () => {
		const parent = {
			KEEP_FOR_TESTS: 'preserved',
			MAX_AUDIO_FILE_SIZE_MB: '1',
			COVER_IMAGE_MAX_SIZE_MB: '2',
			BODY_SIZE_LIMIT: '3M',
			MONGODB_URI: 'mongodb://developer.example.invalid:27017'
		};
		const parentBefore = { ...parent };
		const nodeExecutable = resolve('fixture path with spaces', 'node.exe');
		const vitestEntry = resolve('fixture path with spaces', 'vitest.mjs');
		const configurationRoot = ownedRoot('process-spec');
		const cwd = resolve('fixture cwd with spaces');
		const full = buildVitestProcessSpec(['run'], {
			parentEnvironment: parent,
			nodeExecutable,
			vitestEntry,
			cwd,
			configurationRoot
		});
		const focusedArguments = ['run', 'src/cover fixture with spaces.test.ts'];
		const focused = buildVitestProcessSpec(focusedArguments, {
			parentEnvironment: parent,
			nodeExecutable,
			vitestEntry,
			configurationRoot,
			environmentOverrides: {
				MONGODB_URI: 'mongodb://127.0.0.1:27099/?directConnection=true',
				MONGODB_DB_NAME: 'audio_library_owned_integration',
				MONGODB_TEST_DB_NAME: 'audio_library_test_owned_integration',
				PLAYLIST_IMAGE_STORAGE_PATH: resolve(configurationRoot, 'owned-playlist-images'),
				PLAYLIST_IMAGE_MAX_SIZE_MB: '4'
			}
		});

		expect(full).toMatchObject({
			executable: nodeExecutable,
			arguments: [vitestEntry, 'run'],
			cwd,
			configurationRoot,
			environment: {
				KEEP_FOR_TESTS: 'preserved',
				MONGODB_URI: expect.stringContaining('mongodb://127.0.0.1:1/'),
				MONGODB_DB_NAME: expect.stringMatching(/^audio_library_unit_\d+$/),
				MONGODB_TEST_DB_NAME: expect.stringMatching(/^audio_library_test_unit_\d+$/),
				AUDIO_STORAGE_PATH: resolve(configurationRoot, 'audio'),
				PLAYLIST_IMAGE_STORAGE_PATH: resolve(configurationRoot, 'playlist-images'),
				SESSION_COOKIE_NAME: 'audio_library_unit_test',
				SESSION_DURATION_DAYS: '7',
				MAX_AUDIO_FILE_SIZE_MB: '50',
				COVER_IMAGE_MAX_SIZE_MB: '5',
				PLAYLIST_IMAGE_MAX_SIZE_MB: '5',
				BODY_SIZE_LIMIT: '60M'
			}
		});
		expect(focused.arguments).toEqual([vitestEntry, ...focusedArguments]);
		expect(focused.environment).toMatchObject({
			MONGODB_URI: 'mongodb://127.0.0.1:27099/?directConnection=true',
			MONGODB_DB_NAME: 'audio_library_owned_integration',
			MONGODB_TEST_DB_NAME: 'audio_library_test_owned_integration',
			PLAYLIST_IMAGE_STORAGE_PATH: resolve(configurationRoot, 'owned-playlist-images'),
			PLAYLIST_IMAGE_MAX_SIZE_MB: '4'
		});
		const relation = relative(configurationRoot, full.environment.AUDIO_STORAGE_PATH);
		expect(relation).not.toBe('..');
		expect(relation.startsWith(`..${sep}`)).toBe(false);
		expect(isAbsolute(relation)).toBe(false);
		expect(parent).toEqual(parentBefore);
	});

	it('keeps the fixed Phase 2 suite at the exact intended ten files', () => {
		expect(PLAYLIST_IMAGE_TEST_FILES).toEqual([
			'scripts/lib/direct-module-import-probe-runner.test.mjs',
			'scripts/lib/synthetic-app-environment.test.mjs',
			'src/lib/components/PlaylistArtwork.test.ts',
			'src/lib/server/playlists/management.test.ts',
			'src/lib/server/playlists/mongodb-repository.test.ts',
			'src/lib/server/playlists/picker.test.ts',
			'src/lib/server/playlists/validation.test.ts',
			'src/routes/api/playlists/[publicId]/image/server.test.ts',
			'src/routes/playlists/[publicId]/server.test.ts',
			'src/routes/playlists/server.test.ts'
		]);
	});

	it('resolves the local Vitest Node entry point', () => {
		const entry = resolveLocalVitestEntry();
		expect(isAbsolute(entry)).toBe(true);
		expect(entry.replaceAll('\\', '/')).toMatch(/\/node_modules\/vitest\/vitest\.mjs$/);
	});

	it('propagates the exact child exit code, uses shell-free IO, and cleans its owned root', async () => {
		let invocation;
		const root = ownedRoot('exact-exit');
		const cleanupTemporaryRoot = vi.fn(async () => {});
		const spawnProcess = vi.fn((executable, args, options) => {
			invocation = { executable, args, options };
			const child = new EventEmitter();
			child.exitCode = null;
			child.signalCode = null;
			child.kill = vi.fn();
			queueMicrotask(() => {
				child.exitCode = 7;
				child.emit('close', 7, null);
			});
			return child;
		});

		await expect(runVitest(['run'], {
			spawnProcess,
			makeTemporaryRoot: async () => root,
			cleanupTemporaryRoot
		})).resolves.toBe(7);
		expect(invocation.options).toMatchObject({
			cwd: process.cwd(),
			shell: false,
			stdio: ['ignore', 'inherit', 'inherit'],
			windowsHide: true,
			env: expect.objectContaining({
				MONGODB_URI: expect.stringContaining('mongodb://127.0.0.1:1/'),
				AUDIO_STORAGE_PATH: resolve(root, 'audio'),
				PLAYLIST_IMAGE_STORAGE_PATH: resolve(root, 'playlist-images')
			})
		});
		expect(invocation.args).toEqual([resolveLocalVitestEntry(), 'run']);
		expect(cleanupTemporaryRoot).toHaveBeenCalledOnce();
		expect(cleanupTemporaryRoot).toHaveBeenCalledWith(root);
	});

	it('bounds execution, kills only the owned child, and removes listeners and timers', async () => {
		const root = ownedRoot('timeout');
		const beforeSigint = process.listenerCount('SIGINT');
		const beforeSigterm = process.listenerCount('SIGTERM');
		let child;
		const spawnProcess = vi.fn(() => {
			child = new EventEmitter();
			child.exitCode = null;
			child.signalCode = null;
			child.kill = vi.fn((signal) => {
				child.signalCode = signal;
				queueMicrotask(() => child.emit('close', null, signal));
				return true;
			});
			return child;
		});

		await expect(runVitest(['run', 'focused.test.ts'], {
			spawnProcess,
			makeTemporaryRoot: async () => root,
			cleanupTemporaryRoot: async () => {},
			timeoutMs: 5
		})).resolves.toBe(124);
		expect(child.kill).toHaveBeenCalledOnce();
		expect(child.kill).toHaveBeenCalledWith('SIGKILL');
		expect(child.listenerCount('error')).toBe(0);
		expect(child.listenerCount('close')).toBe(0);
		expect(process.listenerCount('SIGINT')).toBe(beforeSigint);
		expect(process.listenerCount('SIGTERM')).toBe(beforeSigterm);
	});

	it('maps an owned child termination signal to the conventional exit code', async () => {
		const root = ownedRoot('signal-exit');
		const spawnProcess = () => {
			const child = new EventEmitter();
			child.exitCode = null;
			child.signalCode = null;
			child.kill = vi.fn();
			queueMicrotask(() => {
				child.signalCode = 'SIGTERM';
				child.emit('close', null, 'SIGTERM');
			});
			return child;
		};

		await expect(runVitest(['run'], {
			spawnProcess,
			makeTemporaryRoot: async () => root,
			cleanupTemporaryRoot: async () => {}
		})).resolves.toBe(143);
	});

	it('removes an actual owned temporary root after a natural child exit', async () => {
		const root = await mkdtemp(join(tmpdir(), 'audio-library-vitest-cleanup-'));
		const spawnProcess = () => {
			const child = new EventEmitter();
			child.exitCode = null;
			child.signalCode = null;
			child.kill = vi.fn();
			queueMicrotask(() => {
				child.exitCode = 0;
				child.emit('close', 0, null);
			});
			return child;
		};

		await expect(runVitest(['run'], {
			spawnProcess,
			makeTemporaryRoot: async () => root
		})).resolves.toBe(0);
		await expect(access(root)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('preserves a nonzero test exit code when owned-root cleanup also fails', async () => {
		const root = ownedRoot('test-and-cleanup-failure');
		const spawnProcess = () => {
			const child = new EventEmitter();
			child.exitCode = null;
			child.signalCode = null;
			child.kill = vi.fn();
			queueMicrotask(() => {
				child.exitCode = 9;
				child.emit('close', 9, null);
			});
			return child;
		};

		await expect(runVitest(['run'], {
			spawnProcess,
			makeTemporaryRoot: async () => root,
			cleanupTemporaryRoot: async () => { throw new Error('private cleanup detail'); }
		})).resolves.toBe(9);
	});

	it('sanitizes child startup errors and preserves them if cleanup also fails', async () => {
		const secret = 'runner-secret-value';
		const root = ownedRoot('startup-error');
		const spawnProcess = () => {
			const child = new EventEmitter();
			child.exitCode = null;
			child.signalCode = null;
			child.kill = vi.fn();
			queueMicrotask(() => {
				child.emit('error', new Error(`mongodb://fixture:${secret}@example.invalid`));
			});
			return child;
		};

		let message = '';
		try {
			await runVitest(['run'], {
				spawnProcess,
				makeTemporaryRoot: async () => root,
				cleanupTemporaryRoot: async () => {
					throw new Error(`cleanup exposed ${secret}`);
				}
			});
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toBe('Unable to start the local Vitest process.');
		expect(message).not.toContain(secret);
		expect(message).not.toContain('mongodb://');
	});

	it('rejects and does not clean an unowned temporary root', async () => {
		const cleanupTemporaryRoot = vi.fn(async () => {});
		await expect(runVitest(['run'], {
			makeTemporaryRoot: async () => resolve('not-owned-by-vitest'),
			cleanupTemporaryRoot
		})).rejects.toThrow('not an owned temporary directory');
		expect(cleanupTemporaryRoot).not.toHaveBeenCalled();
	});
});

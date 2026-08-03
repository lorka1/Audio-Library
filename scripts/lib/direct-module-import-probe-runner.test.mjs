import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
	buildDirectImportProbeEnvironment,
	runDirectModuleImportProbe
} from './direct-module-import-probe-runner.mjs';

function fakeChild({ code = 0, marker = '', closeOnKill = true } = {}) {
	const child = new EventEmitter();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.kill = vi.fn(() => {
		if (closeOnKill) queueMicrotask(() => child.emit('close', null, 'SIGKILL'));
		return true;
	});
	child.complete = () => {
		if (marker) child.stdout.write(`${marker}\n`);
		child.stdout.end();
		child.stderr.end();
		child.emit('close', code, null);
	};
	return child;
}

describe('shell-free direct module import probe runner', () => {
	it('builds a complete synthetic environment without mutating the parent and lets overrides win', () => {
		const parent = { PARENT_ONLY: 'preserved', MONGODB_URI: 'mongodb://parent.invalid' };
		const environment = buildDirectImportProbeEnvironment('owned-root', {
			BODY_SIZE_LIMIT: '61M'
		}, parent);
		expect(parent).toEqual({ PARENT_ONLY: 'preserved', MONGODB_URI: 'mongodb://parent.invalid' });
		expect(environment).toMatchObject({
			PARENT_ONLY: 'preserved',
			MONGODB_URI: expect.stringContaining('127.0.0.1:1'),
			MAX_AUDIO_FILE_SIZE_MB: '50',
			COVER_IMAGE_MAX_SIZE_MB: '5',
			PLAYLIST_IMAGE_MAX_SIZE_MB: '5',
			BODY_SIZE_LIMIT: '61M',
			SESSION_COOKIE_NAME: 'audio_library_unit_test'
		});
	});

	it('uses process.execPath, argument arrays, shell false, ignored stdin, captured output, and natural success', async () => {
		const child = fakeChild({ marker: 'DIRECT_IMPORT_PROBE_PASSED=playlist-validation' });
		let invocation;
		const spawnChild = vi.fn((...args) => {
			invocation = args;
			queueMicrotask(() => child.complete());
			return child;
		});
		await expect(runDirectModuleImportProbe('playlist-validation', { spawnChild })).resolves.toMatchObject({
			marker: 'DIRECT_IMPORT_PROBE_PASSED=playlist-validation'
		});
		expect(invocation[0]).toBe(process.execPath);
		expect(invocation[1]).toEqual(expect.arrayContaining(['--experimental-strip-types', 'playlist-validation']));
		expect(invocation[2]).toMatchObject({ shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
		expect(child.kill).not.toHaveBeenCalled();
		expect(child.listenerCount('close')).toBe(0);
		expect(child.listenerCount('error')).toBe(0);
	});

	it('propagates a nonzero exit without exposing child output or environment secrets', async () => {
		const child = fakeChild({ code: 1 });
		child.stderr.write('mongodb://private:secret@example.invalid');
		const spawnChild = vi.fn(() => {
			queueMicrotask(() => child.complete());
			return child;
		});
		await expect(runDirectModuleImportProbe('playlist-repository', { spawnChild }))
			.rejects.toThrow('code 1');
		await expect(runDirectModuleImportProbe('playlist-repository', {
			spawnChild: vi.fn(() => {
				const next = fakeChild({ code: 1 });
				queueMicrotask(() => next.complete());
				return next;
			})
		})).rejects.not.toThrow(/mongodb|secret|example\.invalid/);
	});

	it('times out by killing only its owned child and removes listeners and timers', async () => {
		const child = fakeChild();
		await expect(runDirectModuleImportProbe('playlist-validation', {
			timeoutMs: 10,
			spawnChild: vi.fn(() => child)
		})).rejects.toThrow('timed out');
		expect(child.kill).toHaveBeenCalledWith('SIGKILL');
		expect(child.listenerCount('close')).toBe(0);
		expect(child.listenerCount('error')).toBe(0);
		expect(child.stdout.listenerCount('data')).toBe(0);
		expect(child.stderr.listenerCount('data')).toBe(0);
	});

	it('imports both Phase 2 modules with an unavailable synthetic MongoDB endpoint and exits naturally', async () => {
		await expect(runDirectModuleImportProbe('playlist-validation')).resolves.toMatchObject({ target: 'playlist-validation' });
		await expect(runDirectModuleImportProbe('playlist-repository')).resolves.toMatchObject({ target: 'playlist-repository' });
	});
});

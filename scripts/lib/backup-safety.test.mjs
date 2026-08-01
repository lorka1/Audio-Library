import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
	createExclusiveBackupDirectory,
	directoryAggregate,
	requireSafeDestinationRoot
} from './backup-safety.mjs';

const roots = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('backup destination safety', () => {
	it('refuses project, public, source-overlapping and filesystem-root targets', () => {
		expect(() => requireSafeDestinationRoot('.', 'BACKUP_ROOT')).toThrow();
		expect(() => requireSafeDestinationRoot('static/backups', 'BACKUP_ROOT')).toThrow();
		expect(() => requireSafeDestinationRoot(resolve('/'), 'BACKUP_ROOT')).toThrow();
		expect(() => requireSafeDestinationRoot('storage', 'BACKUP_ROOT', {
			forbidden: [resolve('storage/audio')]
		})).toThrow();
	});

	it('never reuses an existing timestamped destination', async () => {
		const root = await mkdtemp(join(tmpdir(), 'audio-library-backup-test-'));
		roots.push(root);
		const now = new Date('2026-01-01T00:00:00.000Z');
		await createExclusiveBackupDirectory(root, 'fixture', now);
		await expect(createExclusiveBackupDirectory(root, 'fixture', now)).rejects.toThrow('already exists');
	});

	it('detects audio aggregate changes without exposing filenames', async () => {
		const root = await mkdtemp(join(tmpdir(), 'audio-library-backup-test-'));
		roots.push(root);
		const source = resolve(root, 'source');
		const copy = resolve(root, 'copy');
		await mkdir(source);
		await mkdir(copy);
		await writeFile(resolve(source, 'fixture.bin'), 'one');
		await writeFile(resolve(copy, 'fixture.bin'), 'two');
		expect(await directoryAggregate(source)).not.toEqual(await directoryAggregate(copy));
	});

	it('handles a missing mongodump binary with an incomplete marker and sanitized output', async () => {
		const root = await mkdtemp(join(tmpdir(), 'audio-library-backup-test-'));
		roots.push(root);
		const secret = 'fixture-secret-value';
		const result = spawnSync(process.execPath, [
			'--experimental-strip-types',
			resolve('scripts/mongodb-backup.mjs')
		], {
			encoding: 'utf8',
			env: {
				...process.env,
				MONGODB_URI: `mongodb://fixture:${secret}@fixture.invalid:27017`,
				MONGODB_DB_NAME: 'audio_library_test_backup_source',
				MONGODB_TEST_DB_NAME: 'audio_library_test_backup_target',
				MONGODB_BACKUP_ROOT: root,
				MONGODUMP_BINARY: 'definitely-missing-mongodump-binary'
			}
		});
		expect(result.status).toBe(1);
		expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
		const entries = await readdir(root);
		expect(entries).toHaveLength(1);
		const destination = resolve(root, entries[0]);
		expect(await readdir(destination)).toContain('INCOMPLETE');
		const manifest = JSON.parse(
			await readFile(resolve(destination, 'manifest.json'), 'utf8')
		);
		expect(Object.keys(manifest).sort()).toEqual([
			'collections',
			'databaseIdentifierHash',
			'format',
			'status',
			'timestamp',
			'toolVersion'
		]);
		expect(JSON.stringify(manifest)).not.toContain(secret);
		expect(JSON.stringify(manifest)).not.toContain('fixture.invalid');
		expect(JSON.stringify(manifest)).not.toContain(root);
	});
});

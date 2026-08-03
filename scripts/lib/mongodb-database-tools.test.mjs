import { constants } from 'node:fs';
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	MongoDatabaseToolResolutionError,
	resolveMongoDatabaseTool
} from './mongodb-database-tools.mjs';

const roots = [];
const originalEnvironment = {
	MONGODUMP_PATH: process.env.MONGODUMP_PATH,
	MONGORESTORE_PATH: process.env.MONGORESTORE_PATH,
	PATH: process.env.PATH
};

async function temporaryRoot(label = 'audio library tools resolver ') {
	const root = await mkdtemp(join(tmpdir(), label));
	roots.push(root);
	return root;
}

async function executable(path) {
	await mkdir(resolve(path, '..'), { recursive: true });
	await writeFile(path, 'synthetic executable fixture');
	await chmod(path, 0o755);
	await access(path, constants.F_OK);
	return path;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
	expect({
		MONGODUMP_PATH: process.env.MONGODUMP_PATH,
		MONGORESTORE_PATH: process.env.MONGORESTORE_PATH,
		PATH: process.env.PATH
	}).toEqual(originalEnvironment);
});

describe('MongoDB Database Tools resolution', () => {
	it('prefers explicit mongodump and mongorestore paths, including paths with spaces', async () => {
		const root = await temporaryRoot();
		const explicitDump = await executable(join(root, 'explicit tools', 'mongodump.exe'));
		const explicitRestore = await executable(join(root, 'explicit tools', 'mongorestore.exe'));
		const pathRoot = join(root, 'path tools');
		await executable(join(pathRoot, 'mongodump.exe'));
		await executable(join(pathRoot, 'mongorestore.exe'));

		await expect(resolveMongoDatabaseTool('mongodump', {
			environment: { MONGODUMP_PATH: explicitDump, PATH: pathRoot },
			platform: 'win32',
			standardSearchRoots: []
		})).resolves.toEqual({
			executablePath: explicitDump,
			source: 'explicit environment'
		});
		await expect(resolveMongoDatabaseTool('mongorestore', {
			environment: { MONGORESTORE_PATH: explicitRestore, PATH: pathRoot },
			platform: 'win32',
			standardSearchRoots: []
		})).resolves.toEqual({
			executablePath: explicitRestore,
			source: 'explicit environment'
		});
	});

	it('reports an invalid explicit path safely without falling through', async () => {
		const secret = 'resolver-secret-value';
		const root = await temporaryRoot('audio-library-tools-resolver-');
		const pathRoot = join(root, 'path');
		await executable(join(pathRoot, 'mongodump.exe'));
		let error;
		try {
			await resolveMongoDatabaseTool('mongodump', {
				environment: {
					MONGODUMP_PATH: join(root, secret, 'missing.exe'),
					MONGODB_URI: `mongodb://fixture:${secret}@example.invalid:27017`,
					PATH: pathRoot
				},
				platform: 'win32',
				standardSearchRoots: []
			});
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(MongoDatabaseToolResolutionError);
		expect(error.message).toContain('mongodump');
		expect(error.message).toContain('MONGODUMP_PATH');
		expect(error.message).not.toContain(secret);
		expect(error.message).not.toContain('mongodb://');
	});

	it('resolves both tools from PATH without changing the environment', async () => {
		const root = await temporaryRoot('audio-library-tools-resolver-');
		const dump = await executable(join(root, 'mongodump.exe'));
		const restore = await executable(join(root, 'mongorestore.exe'));
		const environment = { PATH: root };

		await expect(resolveMongoDatabaseTool('mongodump', {
			environment,
			platform: 'win32',
			standardSearchRoots: []
		})).resolves.toEqual({ executablePath: dump, source: 'PATH' });
		await expect(resolveMongoDatabaseTool('mongorestore', {
			environment,
			platform: 'win32',
			standardSearchRoots: []
		})).resolves.toEqual({ executablePath: restore, source: 'PATH' });
		expect(environment).toEqual({ PATH: root });
	});

	it('selects the highest valid Windows version and ignores incomplete directories', async () => {
		const root = await temporaryRoot('audio-library-tools-resolver-');
		await executable(join(root, '99.9.0', 'bin', 'mongodump.exe'));
		await executable(join(root, '100.9.0', 'bin', 'mongodump.exe'));
		const expected = await executable(join(root, '100.17.0', 'bin', 'mongodump.exe'));
		await mkdir(join(root, '101.0.0', 'bin'), { recursive: true });
		await executable(join(root, 'not-a-version', 'bin', 'mongodump.exe'));

		await expect(resolveMongoDatabaseTool('mongodump', {
			environment: { PATH: '' },
			platform: 'win32',
			standardSearchRoots: [root]
		})).resolves.toEqual({
			executablePath: expected,
			source: 'standard installation discovery'
		});
	});

	it('returns an actionable tool-only error when every bounded source is absent', async () => {
		const root = await temporaryRoot('audio-library-tools-resolver-');
		await expect(resolveMongoDatabaseTool('mongorestore', {
			environment: { PATH: '' },
			platform: 'win32',
			standardSearchRoots: [root]
		})).rejects.toThrow(
			'mongorestore executable was not found. Set MONGORESTORE_PATH or install MongoDB Database Tools.'
		);
	});
});

import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readMongoConfig } from '../src/lib/server/mongodb/config.ts';
import { MONGODB_COLLECTION_NAMES } from '../src/lib/server/mongodb/collections.ts';
import {
	createExclusiveBackupDirectory,
	requireSafeDestinationRoot,
	safeDatabaseIdentifier
} from './lib/backup-safety.mjs';
import {
	MongoDatabaseToolResolutionError,
	probeMongoDatabaseTool,
	resolveMongoDatabaseTool
} from './lib/mongodb-database-tools.mjs';

const config = readMongoConfig(process.env);
const root = requireSafeDestinationRoot(process.env.MONGODB_BACKUP_ROOT, 'MONGODB_BACKUP_ROOT');
const destination = await createExclusiveBackupDirectory(root, 'mongodb');
const incompleteMarker = resolve(destination, 'INCOMPLETE');
const manifestPath = resolve(destination, 'manifest.json');
await writeFile(incompleteMarker, 'Backup has not completed.\n', { flag: 'wx' });
function run(command, args, timeoutMs = 10 * 60_000) {
	return new Promise((resolveRun, rejectRun) => {
		const child = spawn(command, args, {
			shell: false,
			stdio: ['ignore', 'ignore', 'pipe'],
			windowsHide: true
		});
		let stderr = '';
		child.stderr.setEncoding('utf8');
		child.stderr.on('data', (chunk) => {
			stderr = `${stderr}${chunk}`.slice(-4096);
		});
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			rejectRun(new Error('MongoDB backup exceeded its bounded timeout.'));
		}, timeoutMs);
		timer.unref();
		child.once('error', (error) => {
			clearTimeout(timer);
			rejectRun(error);
		});
		child.once('close', (code, signal) => {
			clearTimeout(timer);
			if (code === 0) resolveRun(stderr);
			else rejectRun(Object.assign(new Error('mongodump exited unsuccessfully.'), {
				code,
				signal
			}));
		});
	});
}

try {
	const mongodump = await resolveMongoDatabaseTool('mongodump');
	const version = probeMongoDatabaseTool('mongodump', mongodump.executablePath);
	await run(mongodump.executablePath, [
		'--uri', config.uri,
		'--db', config.databaseName,
		'--out', resolve(destination, 'dump'),
		'--quiet'
	]);
	const databaseDump = resolve(destination, 'dump', config.databaseName);
	if (
		!existsSync(databaseDump) ||
		!(await readdir(databaseDump, { recursive: true })).some((name) => name.endsWith('.bson'))
	) {
		throw new Error('mongodump did not create a complete database backup.');
	}
	const manifest = {
		timestamp: new Date().toISOString(),
		toolVersion: version,
		status: 'complete',
		format: 'mongodb-directory',
		collections: Object.values(MONGODB_COLLECTION_NAMES),
		databaseIdentifierHash: safeDatabaseIdentifier(config.databaseName)
	};
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
	await rm(incompleteMarker);
	console.log(JSON.stringify({ status: 'complete', format: manifest.format }));
} catch (error) {
	await writeFile(
		manifestPath,
		`${JSON.stringify({
			timestamp: new Date().toISOString(),
			toolVersion: 'unavailable',
			status: 'incomplete',
			format: 'mongodb-directory',
			collections: Object.values(MONGODB_COLLECTION_NAMES),
			databaseIdentifierHash: safeDatabaseIdentifier(config.databaseName)
		}, null, 2)}\n`,
		{ flag: existsSync(manifestPath) ? 'w' : 'wx' }
	).catch(() => undefined);
	console.error(
		error instanceof MongoDatabaseToolResolutionError
			? error.message
			: 'MongoDB backup failed; the destination remains clearly marked incomplete.'
	);
	process.exitCode = 1;
}

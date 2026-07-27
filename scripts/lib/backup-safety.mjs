import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, parse, relative, resolve, sep } from 'node:path';

export function contained(parent, child) {
	const relation = relative(resolve(parent), resolve(child));
	return relation === '' ||
		(relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation));
}

export function requireSafeDestinationRoot(value, name, { projectRoot = process.cwd(), forbidden = [] } = {}) {
	if (!value?.trim()) throw new Error(`Missing required environment variable ${name}.`);
	const destination = resolve(value.trim());
	if (destination === parse(destination).root || destination === resolve(projectRoot)) {
		throw new Error(`${name} must select a dedicated backup directory.`);
	}
	for (const path of [
		resolve(projectRoot, 'static'),
		resolve(projectRoot, 'public'),
		resolve(projectRoot, 'build'),
		...forbidden.map((path) => resolve(path))
	]) {
		if (contained(path, destination) || contained(destination, path)) {
			throw new Error(`${name} conflicts with an application or source directory.`);
		}
	}
	return destination;
}

export function backupTimestamp(now = new Date()) {
	return now.toISOString().replaceAll(':', '').replaceAll('.', '-');
}

export async function createExclusiveBackupDirectory(root, prefix, now = new Date()) {
	await mkdir(root, { recursive: true });
	const destination = resolve(root, `${prefix}-${backupTimestamp(now)}`);
	if (existsSync(destination)) throw new Error('The timestamped backup destination already exists.');
	await mkdir(destination, { recursive: false });
	return destination;
}

export async function directoryAggregate(root) {
	const files = [];
	async function visit(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name);
			if (!contained(root, path)) throw new Error('Backup traversal escaped its root.');
			if (entry.isDirectory()) await visit(path);
			else if (entry.isFile()) files.push(path);
			else throw new Error('Backup source contains an unsupported filesystem entry.');
		}
	}
	await visit(root);
	files.sort((a, b) => relative(root, a).localeCompare(relative(root, b)));
	let byteSize = 0;
	const hash = createHash('sha256');
	for (const path of files) {
		const info = await stat(path);
		const name = relative(root, path).split(sep).join('/');
		const content = await readFile(path);
		byteSize += info.size;
		hash.update(name);
		hash.update('\0');
		hash.update(String(info.size));
		hash.update('\0');
		hash.update(content);
	}
	return { fileCount: files.length, byteSize, contentHash: hash.digest('hex') };
}

export function safeDatabaseIdentifier(name) {
	return createHash('sha256').update(name).digest('hex');
}

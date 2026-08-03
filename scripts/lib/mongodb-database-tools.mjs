import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';

const TOOL_SETTINGS = Object.freeze({
	mongodump: {
		pathVariable: 'MONGODUMP_PATH',
		legacyVariable: 'MONGODUMP_BINARY'
	},
	mongorestore: {
		pathVariable: 'MONGORESTORE_PATH',
		legacyVariable: 'MONGORESTORE_BINARY'
	}
});

export class MongoDatabaseToolResolutionError extends Error {
	constructor(tool, variable) {
		super(
			variable
				? `${tool} executable configured by ${variable} is unavailable.`
				: `${tool} executable was not found. Set ${TOOL_SETTINGS[tool].pathVariable} or install MongoDB Database Tools.`
		);
		this.name = 'MongoDatabaseToolResolutionError';
		this.tool = tool;
		this.variable = variable ?? null;
	}
}

function settingFor(tool) {
	const setting = TOOL_SETTINGS[tool];
	if (!setting) throw new TypeError('Unsupported MongoDB Database Tool name.');
	return setting;
}

function environmentValue(environment, name) {
	const entry = Object.entries(environment).find(
		([key]) => key.toLowerCase() === name.toLowerCase()
	);
	return typeof entry?.[1] === 'string' ? entry[1].trim() : '';
}

async function isExecutableFile(path, platform) {
	try {
		const information = await stat(path);
		if (!information.isFile()) return false;
		if (platform !== 'win32') await access(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function executableNames(tool, platform) {
	return platform === 'win32' ? [`${tool}.exe`, tool] : [tool];
}

async function resolveFromPath(tool, environment, platform) {
	const pathValue = environmentValue(environment, 'PATH');
	if (!pathValue) return null;
	const pathDelimiter = platform === 'win32' ? ';' : delimiter;
	for (const directory of pathValue.split(pathDelimiter).filter(Boolean)) {
		for (const name of executableNames(tool, platform)) {
			const candidate = resolve(directory, name);
			if (await isExecutableFile(candidate, platform)) return candidate;
		}
	}
	return null;
}

function compareVersionDirectories(left, right) {
	const leftParts = left.split('.').map(Number);
	const rightParts = right.split('.').map(Number);
	const length = Math.max(leftParts.length, rightParts.length);
	for (let index = 0; index < length; index += 1) {
		const difference = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return right.localeCompare(left, 'en');
}

async function versionDirectories(root) {
	try {
		return (await readdir(root, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory() && /^\d+(?:\.\d+)*$/.test(entry.name))
			.map((entry) => entry.name)
			.sort(compareVersionDirectories);
	} catch (error) {
		if (error?.code === 'ENOENT' || error?.code === 'EACCES') return [];
		throw error;
	}
}

function defaultWindowsToolsRoots(environment) {
	const programFiles =
		environmentValue(environment, 'ProgramFiles') || 'C:\\Program Files';
	return [join(programFiles, 'MongoDB', 'Tools')];
}

async function resolveFromWindowsInstallations(tool, roots, platform) {
	for (const root of roots) {
		for (const version of await versionDirectories(root)) {
			const candidate = resolve(root, version, 'bin', `${tool}.exe`);
			if (await isExecutableFile(candidate, platform)) return candidate;
		}
	}
	return null;
}

async function resolveExplicit(tool, value, variable, environment, platform) {
	const candidate = isAbsolute(value) || dirname(value) !== '.'
		? resolve(value)
		: await resolveFromPath(value, environment, platform);
	if (candidate && await isExecutableFile(candidate, platform)) return candidate;
	throw new MongoDatabaseToolResolutionError(tool, variable);
}

export async function resolveMongoDatabaseTool(tool, options = {}) {
	const setting = settingFor(tool);
	const environment = options.environment ?? process.env;
	const platform = options.platform ?? process.platform;
	const explicitPath = environmentValue(environment, setting.pathVariable);
	if (explicitPath) {
		return {
			executablePath: await resolveExplicit(
				tool,
				explicitPath,
				setting.pathVariable,
				environment,
				platform
			),
			source: 'explicit environment'
		};
	}

	const legacyBinary = environmentValue(environment, setting.legacyVariable);
	if (legacyBinary) {
		return {
			executablePath: await resolveExplicit(
				tool,
				legacyBinary,
				setting.legacyVariable,
				environment,
				platform
			),
			source: 'explicit environment'
		};
	}

	const pathExecutable = await resolveFromPath(tool, environment, platform);
	if (pathExecutable) {
		return { executablePath: pathExecutable, source: 'PATH' };
	}

	if (platform === 'win32') {
		const standardExecutable = await resolveFromWindowsInstallations(
			tool,
			options.standardSearchRoots ?? defaultWindowsToolsRoots(environment),
			platform
		);
		if (standardExecutable) {
			return {
				executablePath: standardExecutable,
				source: 'standard installation discovery'
			};
		}
	}

	throw new MongoDatabaseToolResolutionError(tool);
}

export function probeMongoDatabaseTool(tool, executablePath, timeoutMs = 5_000) {
	settingFor(tool);
	const result = spawnSync(executablePath, ['--version'], {
		encoding: 'utf8',
		shell: false,
		timeout: timeoutMs,
		windowsHide: true
	});
	if (result.error || result.status !== 0) {
		throw new Error(`${tool} version probe failed.`);
	}
	const version = `${result.stdout}${result.stderr}`.match(/\b\d+\.\d+\.\d+\b/)?.[0];
	if (!version) throw new Error(`${tool} version could not be identified.`);
	return version;
}

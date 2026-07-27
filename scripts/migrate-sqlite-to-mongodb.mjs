import 'dotenv/config';
import { resolve } from 'node:path';
import { MongoClientManager } from '../src/lib/server/mongodb/client.ts';
import {
	assertMongoTestDatabaseName,
	readMongoConfig
} from '../src/lib/server/mongodb/config.ts';
import { getMongoCollections } from '../src/lib/server/mongodb/collections.ts';
import {
	applyMigration,
	dryRunMigration,
	MIGRATION_CONFIRMATION,
	readSqliteMigrationSnapshot,
	resolveSqliteSource,
	verifyMigration
} from './lib/sqlite-mongodb-migration.mjs';

function argumentsMap(argv) {
	const result = new Map();
	for (const argument of argv) {
		if (!argument.startsWith('--')) throw new Error('Unsupported migration argument.');
		const [name, ...parts] = argument.slice(2).split('=');
		result.set(name, parts.join('=') || 'true');
	}
	return result;
}

function safeReport(mode, result) {
	if (mode === 'dry-run') {
		return {
			mode,
			writesPerformed: false,
			source: {
				userCount: result.analysis.userCount,
				trackCount: result.analysis.trackCount,
				sessionCountExcluded: result.analysis.sessionCountExcluded,
				publicCount: result.analysis.publicCount,
				privateCount: result.analysis.privateCount,
				withBpmCount: result.analysis.withBpmCount,
				withoutBpmCount: result.analysis.withoutBpmCount,
				minPublicId: result.analysis.minPublicId,
				maxPublicId: result.analysis.maxPublicId,
				conflictCategoryCount: result.analysis.categories.length,
				fingerprintAvailable: result.analysis.fingerprint !== null
			},
			target: result.target,
			requiredIndexesPresent: result.indexes.compatible,
			missingIndexCount: result.indexes.missingCount,
			transactionSupported: result.transactionSupported,
			targetUnchanged: result.targetUnchanged,
			canApply: result.canApply
		};
	}
	if (mode === 'verify') {
		return {
			mode,
			writesPerformed: false,
			ok: result.ok,
			checks: result.checks
		};
	}
	return {
		mode,
		writesPerformed: result.applied,
		rerun: result.rerun,
		verified: result.verification.ok
	};
}

function safeError(error) {
	if (error?.name === 'MigrationValidationError') {
		return `Migration validation failed in ${error.categories.length} safe aggregate categories.`;
	}
	const allowed = [
		'Missing required environment variable',
		'Migration source must',
		'Apply mode requires',
		'MongoDB migration apply requires',
		'Required MongoDB indexes are missing.',
		'Target MongoDB database is non-empty or incompatible.',
		'Migration verification failed'
	];
	if (error instanceof Error && allowed.some((prefix) => error.message.startsWith(prefix))) {
		return error.message;
	}
	return 'SQLite-to-MongoDB migration controller failed safely.';
}

async function main() {
	const args = argumentsMap(process.argv.slice(2));
	const mode = args.get('mode') ?? 'dry-run';
	if (!['dry-run', 'apply', 'verify'].includes(mode)) {
		throw new Error('Migration mode must be dry-run, apply, or verify.');
	}
	const target = args.get('target');
	if (target !== 'development' && target !== 'test') {
		throw new Error('Migration target must be explicitly development or test.');
	}
	const config = readMongoConfig(process.env);
	const databaseName =
		target === 'development' ? config.databaseName : config.testDatabaseName;
	if (target === 'test') {
		assertMongoTestDatabaseName(databaseName, config.databaseName);
	} else if (databaseName.startsWith('audio_library_test_')) {
		throw new Error('Development migration target must not use a test database name.');
	}
	const sourcePath = args.has('source')
		? resolve(process.cwd(), args.get('source'))
		: resolveSqliteSource(process.env.DATABASE_URL);
	const audioStoragePath = resolve(
		process.cwd(),
		args.get('audio-root') ?? process.env.AUDIO_STORAGE_PATH ?? 'storage/audio'
	);
	const opened = await readSqliteMigrationSnapshot({
		sourcePath,
		audioStoragePath
	});
	const manager = new MongoClientManager({
		...config,
		databaseName
	});
	try {
		const client = await manager.connect();
		const collections = getMongoCollections(client.db(databaseName));
		let result;
		if (mode === 'dry-run') {
			result = await dryRunMigration({
				snapshot: opened.snapshot,
				analysis: opened.analysis,
				collections,
				client
			});
		} else if (mode === 'verify') {
			result = await verifyMigration({
				snapshot: opened.snapshot,
				analysis: opened.analysis,
				collections
			});
		} else {
			result = await applyMigration({
				snapshot: opened.snapshot,
				analysis: opened.analysis,
				collections,
				client,
				confirmation: args.get('confirm')
			});
		}
		console.log(JSON.stringify(safeReport(mode, result), null, 2));
		if ((mode === 'verify' && !result.ok) || (mode === 'dry-run' && !result.analysis.valid)) {
			process.exitCode = 1;
		}
	} finally {
		opened.close();
		await manager.close(true);
	}
}

main().catch((error) => {
	console.error(safeError(error));
	if (
		process.argv.includes('--mode=apply') &&
		!process.argv.includes(`--confirm=${MIGRATION_CONFIRMATION}`)
	) {
		console.error('No migration writes were authorized.');
	}
	process.exitCode = 1;
});

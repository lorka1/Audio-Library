import 'dotenv/config';
import {
	readMongoConfig
} from '../src/lib/server/mongodb/config.ts';
import {
	MongoClientManager
} from '../src/lib/server/mongodb/client.ts';
import {
	getMongoCollections
} from '../src/lib/server/mongodb/collections.ts';
import {
	ensureMongoIndexes
} from '../src/lib/server/mongodb/indexes.ts';

const TOTAL_TIMEOUT_MS = 30_000;
const OPERATION_TIMEOUT_MS = 5_000;

function safeFailureMessage(error) {
	if (
		error instanceof Error &&
		(error.message.startsWith('Missing required environment variable MONGODB_') ||
			error.message.startsWith('MONGODB_'))
	) {
		return error.message;
	}

	return 'MongoDB connection check failed. Verify the private URI, server availability, and database permissions.';
}

async function runMongoCheck(manager, config, signal) {
	const client = await manager.connect();
	const database = client.db(config.databaseName);

	await database.command(
		{ ping: 1 },
		{ maxTimeMS: OPERATION_TIMEOUT_MS, signal }
	);

	const collections = getMongoCollections(database);
	const ensuredIndexes = await ensureMongoIndexes(collections, {
		maxTimeMS: OPERATION_TIMEOUT_MS
	});
	const existingCollections = await database
		.listCollections(
			{},
			{ nameOnly: true, maxTimeMS: OPERATION_TIMEOUT_MS, signal }
		)
		.toArray();
	const expectedCollectionNames = new Set([
		'users',
		'sessions',
		'tracks',
		'counters'
	]);
	const safeCollectionNames = existingCollections
		.map((collection) => collection.name)
		.filter((name) => expectedCollectionNames.has(name))
		.sort();

	console.log(
		JSON.stringify({
			status: 'ok',
			databaseRole: 'development',
			collections: safeCollectionNames,
			indexes: {
				users: ensuredIndexes.users,
				sessions: ensuredIndexes.sessions,
				tracks: ensuredIndexes.tracks,
				counters: ensuredIndexes.counters
			}
		})
	);
}

async function main() {
	const config = readMongoConfig(process.env);
	const manager = new MongoClientManager(config);
	const abortController = new AbortController();
	const watchdog = setTimeout(() => {
		abortController.abort(
			new Error('MongoDB connection check exceeded its total timeout.')
		);
	}, TOTAL_TIMEOUT_MS);
	watchdog.unref();

	try {
		await runMongoCheck(manager, config, abortController.signal);
	} finally {
		clearTimeout(watchdog);
		await manager.close(true);
	}
}

main().catch((error) => {
	console.error(safeFailureMessage(error));
	process.exitCode = 1;
});

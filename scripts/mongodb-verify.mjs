import 'dotenv/config';
import { MongoClientManager } from '../src/lib/server/mongodb/client.ts';
import { readMongoConfig } from '../src/lib/server/mongodb/config.ts';
import { getMongoCollections } from '../src/lib/server/mongodb/collections.ts';
import { verifyMongoOperationalState } from '../src/lib/server/mongodb/verification.ts';

const config = readMongoConfig(process.env);
const manager = new MongoClientManager(config);
try {
	const client = await manager.connect();
	const database = client.db(config.databaseName);
	const result = await verifyMongoOperationalState(client, database);
	const marker = await getMongoCollections(database).migrations.findOne(
		{ version: 1 },
		{
			projection: {
				_id: 0,
				version: 1,
				userCount: 1,
				trackCount: 1,
				maxPublicId: 1,
				fingerprint: 1,
				completedAt: 1
			},
			maxTimeMS: 4_000
		}
	);
	if (marker && (
		marker.version !== 1 ||
		!Number.isSafeInteger(marker.userCount) ||
		!Number.isSafeInteger(marker.trackCount) ||
		!Number.isSafeInteger(marker.maxPublicId) ||
		typeof marker.fingerprint !== 'string' ||
		marker.fingerprint.length === 0 ||
		!(marker.completedAt instanceof Date)
	)) {
		throw new Error('Historical migration marker is structurally incompatible.');
	}
	console.log(JSON.stringify({
		status: 'ok',
		writesPerformed: false,
		topology: result.topology,
		primary: result.primary,
		transactionCapable: result.transactionCapable,
		collectionsCompatible: result.collectionsCompatible,
		indexesCompatible: result.indexesCompatible,
		counterCompatible: result.counterCompatible,
		migrationMarker: marker ? 'compatible' : 'not-present'
	}));
} catch {
	console.error('MongoDB verification failed. Check private configuration, topology, indexes, and counter state.');
	process.exitCode = 1;
} finally {
	await manager.close(true).catch(() => {
		process.exitCode = 1;
	});
}

import 'dotenv/config';
import { MongoClientManager } from '../src/lib/server/mongodb/client.ts';
import { readMongoConfig } from '../src/lib/server/mongodb/config.ts';
import { getMongoCollections } from '../src/lib/server/mongodb/collections.ts';
import { TRACK_PUBLIC_ID_COUNTER } from '../src/lib/server/mongodb/documents.ts';
import { ensureMongoIndexes } from '../src/lib/server/mongodb/indexes.ts';

const config = readMongoConfig(process.env);
const manager = new MongoClientManager(config);
try {
	const client = await manager.connect();
	const collections = getMongoCollections(client.db(config.databaseName));
	await ensureMongoIndexes(collections, { maxTimeMS: 8_000 });
	await collections.counters.updateOne(
		{ _id: TRACK_PUBLIC_ID_COUNTER },
		{ $setOnInsert: { value: 0 } },
		{ upsert: true }
	);
	console.log(JSON.stringify({ status: 'initialized' }));
} catch {
	console.error('MongoDB initialization failed. No index was dropped or rebuilt.');
	process.exitCode = 1;
} finally {
	await manager.close(true).catch(() => {
		process.exitCode = 1;
	});
}

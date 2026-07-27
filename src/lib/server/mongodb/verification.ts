import type { Db, IndexDescriptionInfo, MongoClient } from 'mongodb';
import { getMongoCollections, MONGODB_COLLECTION_NAMES } from './collections.ts';
import { TRACK_PUBLIC_ID_COUNTER } from './documents.ts';
import { MONGODB_INDEX_DEFINITIONS, type PlannedMongoIndex } from './indexes.ts';

export const MONGODB_OPERATION_TIMEOUT_MS = 4_000;

export interface MongoOperationalVerification {
	primary: true;
	transactionCapable: true;
	collectionsCompatible: true;
	indexesCompatible: true;
	counterCompatible: true;
	topology: 'replicaSet' | 'sharded';
}

export function isMongoCounterCompatible(
	value: unknown,
	maximumPublicId: unknown
): boolean {
	return Number.isSafeInteger(value) &&
		(value as number) >= 0 &&
		Number.isSafeInteger(maximumPublicId) &&
		(maximumPublicId as number) >= 0 &&
		(value as number) >= (maximumPublicId as number);
}

function entries(value: unknown): [string, unknown][] {
	if (!value || typeof value !== 'object') return [];
	return Object.entries(value);
}

function sameKey(actual: unknown, expected: unknown): boolean {
	return JSON.stringify(entries(actual)) === JSON.stringify(entries(expected));
}

export function isRequiredMongoIndexCompatible(
	actual: IndexDescriptionInfo,
	expected: PlannedMongoIndex
): boolean {
	return actual.name === expected.name &&
		sameKey(actual.key, expected.key) &&
		Boolean(actual.unique) === Boolean(expected.unique) &&
		Boolean(actual.sparse) === Boolean(expected.sparse) &&
		JSON.stringify(actual.partialFilterExpression ?? null) ===
			JSON.stringify(expected.partialFilterExpression ?? null);
}

async function verifyIndexes(database: Db): Promise<void> {
	const collections = getMongoCollections(database);
	for (const [name, definitions] of Object.entries(MONGODB_INDEX_DEFINITIONS)) {
		const actual = await collections[name as keyof typeof MONGODB_INDEX_DEFINITIONS].indexes({
			maxTimeMS: MONGODB_OPERATION_TIMEOUT_MS
		});
		for (const expected of definitions) {
			if (!actual.some((candidate) => isRequiredMongoIndexCompatible(candidate, expected))) {
				throw new Error(`Required MongoDB index is missing or incompatible: ${expected.name}.`);
			}
		}
	}
}

export async function verifyMongoOperationalState(
	client: MongoClient,
	database: Db
): Promise<MongoOperationalVerification> {
	const hello = await client.db('admin').command(
		{ hello: 1 },
		{ timeoutMS: MONGODB_OPERATION_TIMEOUT_MS }
	);
	if (hello.isWritablePrimary !== true) {
		throw new Error('MongoDB has no writable PRIMARY.');
	}
	const topology = hello.msg === 'isdbgrid'
		? 'sharded'
		: typeof hello.setName === 'string'
			? 'replicaSet'
			: null;
	if (!topology) {
		throw new Error('MongoDB transaction support requires a replica set or sharded deployment.');
	}

	const existing = new Set(
		(await database.listCollections(
			{},
			{ nameOnly: true, maxTimeMS: MONGODB_OPERATION_TIMEOUT_MS }
		).toArray()).map(({ name }) => name)
	);
	for (const name of [
		MONGODB_COLLECTION_NAMES.users,
		MONGODB_COLLECTION_NAMES.sessions,
		MONGODB_COLLECTION_NAMES.tracks,
		MONGODB_COLLECTION_NAMES.counters
	]) {
		if (!existing.has(name)) throw new Error('Required MongoDB collections are incomplete.');
	}
	await verifyIndexes(database);

	const collections = getMongoCollections(database);
	const [counter, maximumTrack] = await Promise.all([
		collections.counters.findOne(
		{ _id: TRACK_PUBLIC_ID_COUNTER },
		{ projection: { _id: 0, value: 1 }, maxTimeMS: MONGODB_OPERATION_TIMEOUT_MS }
		),
		collections.tracks.find(
			{},
			{
				projection: { _id: 0, publicId: 1 },
				maxTimeMS: MONGODB_OPERATION_TIMEOUT_MS,
				hint: 'tracks_public_id_unique'
			}
		).sort({ publicId: -1 }).limit(1).next()
	]);
	if (!counter || !isMongoCounterCompatible(
		counter.value,
		maximumTrack?.publicId ?? 0
	)) {
		throw new Error('MongoDB public track-ID counter is structurally incompatible.');
	}

	return {
		primary: true,
		transactionCapable: true,
		collectionsCompatible: true,
		indexesCompatible: true,
		counterCompatible: true,
		topology
	};
}

import {
	MongoClient,
	type Db,
	type MongoClientOptions
} from 'mongodb';
import type { MongoConfig, MongoEnvironment } from './config.ts';
import {
	assertMongoTestDatabaseName,
	readMongoConfig
} from './config.ts';

export type MongoClientFactory = (
	uri: string,
	options: MongoClientOptions
) => MongoClient;

const defaultMongoClientFactory: MongoClientFactory = (uri, options) =>
	new MongoClient(uri, options);

export interface MongoConnection {
	client: MongoClient;
	database: Db;
}

export class MongoClientManager {
	readonly #config: MongoConfig;
	readonly #factory: MongoClientFactory;
	#client: MongoClient | undefined;
	#connectionPromise: Promise<MongoClient> | undefined;

	constructor(
		config: MongoConfig,
		factory: MongoClientFactory = defaultMongoClientFactory
	) {
		this.#config = config;
		this.#factory = factory;
	}

	connect(): Promise<MongoClient> {
		if (this.#connectionPromise) {
			return this.#connectionPromise;
		}

		const client = this.#factory(this.#config.uri, {
			appName: 'audio-library',
			serverSelectionTimeoutMS: this.#config.serverSelectionTimeoutMs,
			connectTimeoutMS: this.#config.serverSelectionTimeoutMs,
			socketTimeoutMS: this.#config.serverSelectionTimeoutMs
		});
		this.#client = client;

		let attempt: Promise<MongoClient>;
		attempt = client.connect().catch(async (error: unknown) => {
			if (this.#connectionPromise === attempt) {
				this.#connectionPromise = undefined;
				this.#client = undefined;
			}

			await client.close(true).catch(() => undefined);
			throw error;
		});
		this.#connectionPromise = attempt;
		return attempt;
	}

	async close(force = false): Promise<void> {
		const client = this.#client;
		this.#client = undefined;
		this.#connectionPromise = undefined;

		if (client) {
			await client.close(force);
		}
	}
}

let processManager: MongoClientManager | undefined;
let processConfigSignature: string | undefined;

function configSignature(config: MongoConfig): string {
	return JSON.stringify([
		config.uri,
		config.databaseName,
		config.testDatabaseName,
		config.serverSelectionTimeoutMs
	]);
}

function processMongoManager(config: MongoConfig): MongoClientManager {
	const signature = configSignature(config);

	if (!processManager) {
		processManager = new MongoClientManager(config);
		processConfigSignature = signature;
	} else if (processConfigSignature !== signature) {
		throw new Error(
			'MongoDB configuration changed while an owned client was active.'
		);
	}

	return processManager;
}

export async function connectMongoDevelopment(
	environment: MongoEnvironment = process.env
): Promise<MongoConnection> {
	const config = readMongoConfig(environment);
	const client = await processMongoManager(config).connect();
	return {
		client,
		database: client.db(config.databaseName)
	};
}

export async function connectMongoTest(
	environment: MongoEnvironment = process.env
): Promise<MongoConnection> {
	const config = readMongoConfig(environment);
	assertMongoTestDatabaseName(
		config.testDatabaseName,
		config.databaseName
	);
	const client = await processMongoManager(config).connect();
	return {
		client,
		database: client.db(config.testDatabaseName)
	};
}

export async function closeMongoClient(force = false): Promise<void> {
	const manager = processManager;
	processManager = undefined;
	processConfigSignature = undefined;

	if (manager) {
		await manager.close(force);
	}
}

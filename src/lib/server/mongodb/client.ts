import {
	MongoClient,
	type Db,
	type MongoClientOptions
} from 'mongodb';
import type { MongoConfig, MongoEnvironment } from './config.ts';
import { readMongoConfig } from './config.ts';
import { safeErrorFields, writeSafeLog } from '../operational/logging.ts';

export type MongoClientFactory = (
	uri: string,
	options: MongoClientOptions
) => MongoClient;
export type MongoCleanupFailureReporter = (error: unknown) => void;

const defaultMongoClientFactory: MongoClientFactory = (uri, options) =>
	new MongoClient(uri, options);
const defaultCleanupFailureReporter: MongoCleanupFailureReporter = (error) =>
	writeSafeLog({
		severity: 'error',
		category: 'shutdown',
		...safeErrorFields(error)
	});

export interface MongoConnection {
	client: MongoClient;
	database: Db;
}

export class MongoClientManager {
	readonly #config: MongoConfig;
	readonly #factory: MongoClientFactory;
	readonly #reportCleanupFailure: MongoCleanupFailureReporter;
	#client: MongoClient | undefined;
	#connectionPromise: Promise<MongoClient> | undefined;
	#closePromises = new WeakMap<MongoClient, Promise<void>>();

	constructor(
		config: MongoConfig,
		factory: MongoClientFactory = defaultMongoClientFactory,
		reportCleanupFailure: MongoCleanupFailureReporter = defaultCleanupFailureReporter
	) {
		this.#config = config;
		this.#factory = factory;
		this.#reportCleanupFailure = reportCleanupFailure;
	}

	connect(): Promise<MongoClient> {
		if (this.#connectionPromise) {
			return this.#connectionPromise;
		}

		const client = this.#factory(this.#config.uri, {
			appName: 'audio-library',
			serverSelectionTimeoutMS: this.#config.serverSelectionTimeoutMs,
			connectTimeoutMS: this.#config.connectTimeoutMs,
			socketTimeoutMS: this.#config.socketTimeoutMs,
			retryWrites: true
		});
		this.#client = client;

		let attempt: Promise<MongoClient>;
		attempt = client.connect().catch(async (error: unknown) => {
			if (this.#connectionPromise === attempt) {
				this.#connectionPromise = undefined;
				this.#client = undefined;
			}

			await this.#closeOnce(client, true).catch((cleanupError) => {
				this.#reportCleanupFailure(cleanupError);
			});
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
			await this.#closeOnce(client, force);
		}
	}

	#closeOnce(client: MongoClient, force: boolean): Promise<void> {
		const existing = this.#closePromises.get(client);
		if (existing) return existing;
		const closing = client.close(force);
		this.#closePromises.set(client, closing);
		return closing;
	}
}

const CLIENT_STATE_KEY = Symbol.for('audio-library.mongodb-client-state');
interface ProcessClientState {
	manager?: MongoClientManager;
	configSignature?: string;
	applicationConfig?: MongoConfig;
}
const processState = (
	(globalThis as typeof globalThis & { [CLIENT_STATE_KEY]?: ProcessClientState })[
		CLIENT_STATE_KEY
	] ??= {}
);

function configSignature(config: MongoConfig): string {
	return JSON.stringify([
		config.uri,
		config.databaseName,
		config.testDatabaseName,
		config.serverSelectionTimeoutMs,
		config.connectTimeoutMs,
		config.socketTimeoutMs
	]);
}

function processMongoManager(config: MongoConfig): MongoClientManager {
	const signature = configSignature(config);

	if (!processState.manager) {
		processState.manager = new MongoClientManager(config);
		processState.configSignature = signature;
	} else if (processState.configSignature !== signature) {
		throw new Error(
			'MongoDB configuration changed while an owned client was active.'
		);
	}

	return processState.manager;
}

export function configureMongoApplicationConfig(config: MongoConfig): void {
	const signature = configSignature(config);
	if (
		processState.applicationConfig &&
		configSignature(processState.applicationConfig) !== signature
	) {
		throw new Error(
			'MongoDB application configuration changed during the process lifetime.'
		);
	}
	processState.applicationConfig = config;
}

export async function connectMongoDevelopment(
	environment?: MongoEnvironment
): Promise<MongoConnection> {
	const config = environment
		? readMongoConfig(environment)
		: processState.applicationConfig ?? readMongoConfig(process.env);
	const client = await processMongoManager(config).connect();
	const database = client.db(config.databaseName);
	return {
		client,
		database
	};
}

export async function closeMongoClient(force = false): Promise<void> {
	const manager = processState.manager;
	processState.manager = undefined;
	processState.configSignature = undefined;

	if (manager) {
		await manager.close(force);
	}
}

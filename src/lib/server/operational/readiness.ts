import { getServerConfig } from '../config';
import {
	configureMongoApplicationConfig,
	connectMongoDevelopment
} from '../mongodb/client';
import { verifyMongoOperationalState } from '../mongodb/verification';
import {
	checkPrivateAudioStorage,
	checkPrivateCoverImageStorage,
	checkPrivatePlaylistImageStorage
} from './config';

export const READINESS_TIMEOUT_MS = 5_000;

export type ReadinessFailureCategory = 'mongodb' | 'filesystem';
export type ReadinessFailureCode =
	| 'readiness_mongodb_unavailable'
	| 'readiness_mongodb_incompatible'
	| 'readiness_storage_unavailable'
	| 'readiness_timeout';

export class ReadinessError extends Error {
	readonly category: ReadinessFailureCategory;
	readonly safeCode: ReadinessFailureCode;

	constructor(
		category: ReadinessFailureCategory,
		safeCode: ReadinessFailureCode
	) {
		super('Application readiness verification failed.');
		this.name = 'ReadinessError';
		this.category = category;
		this.safeCode = safeCode;
	}
}

export interface ReadinessDependencies {
	verify(): Promise<void>;
	timeoutMs?: number;
}

function defaultReadinessDependencies(): ReadinessDependencies {
	return {
		async verify() {
			const config = getServerConfig();
			let connection: Awaited<ReturnType<typeof connectMongoDevelopment>>;
			try {
				configureMongoApplicationConfig(config.mongo);
				connection = await connectMongoDevelopment();
			} catch {
				throw new ReadinessError(
					'mongodb',
					'readiness_mongodb_unavailable'
				);
			}
			try {
				await verifyMongoOperationalState(
					connection.client,
					connection.database
				);
			} catch {
				throw new ReadinessError(
					'mongodb',
					'readiness_mongodb_incompatible'
				);
			}
			try {
				await checkPrivateAudioStorage(config.audioStoragePath);
				await checkPrivateCoverImageStorage(
					config.coverImageStoragePath
				);
				await checkPrivatePlaylistImageStorage(config.playlistImageStoragePath);
			} catch {
				throw new ReadinessError(
					'filesystem',
					'readiness_storage_unavailable'
				);
			}
		}
	};
}

export async function checkApplicationReadiness(
	dependencies: ReadinessDependencies = defaultReadinessDependencies()
): Promise<void> {
	let timer: NodeJS.Timeout | undefined;
	try {
		await Promise.race([
			dependencies.verify(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new ReadinessError('mongodb', 'readiness_timeout')),
					dependencies.timeoutMs ?? READINESS_TIMEOUT_MS
				);
				timer.unref();
			})
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

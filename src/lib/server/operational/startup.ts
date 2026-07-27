import { serverConfig } from '../config';
import {
	closeMongoClient,
	configureMongoApplicationConfig,
	connectMongoDevelopment
} from '../mongodb/client';
import { verifyMongoOperationalState } from '../mongodb/verification';
import { assertProductionRuntimeConfig, preparePrivateAudioStorage } from './config';
import { safeErrorFields, writeSafeLog } from './logging';

const STARTUP_KEY = Symbol.for('audio-library.operational-startup');
type StartupState = { promise?: Promise<void> };
const state = ((globalThis as typeof globalThis & { [STARTUP_KEY]?: StartupState })[STARTUP_KEY] ??= {});

export function initializeApplication(): Promise<void> {
	if (state.promise) return state.promise;
	const attempt = (async () => {
		assertProductionRuntimeConfig(process.env);
		configureMongoApplicationConfig(serverConfig.mongo);
		await preparePrivateAudioStorage(serverConfig.audioStoragePath);
		const { client, database } = await connectMongoDevelopment();
		await verifyMongoOperationalState(client, database);
		writeSafeLog({ severity: 'info', category: 'configuration', code: 'startup_ready' });
	})();
	state.promise = attempt.catch(async (error) => {
		state.promise = undefined;
		await closeMongoClient(true).catch((cleanupError) => {
			writeSafeLog({
				severity: 'error',
				category: 'shutdown',
				...safeErrorFields(cleanupError)
			});
		});
		throw error;
	});
	return state.promise;
}

export function resetApplicationStartupForTests(): void {
	state.promise = undefined;
}

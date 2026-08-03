import { getServerConfig } from '../config';
import {
	closeMongoClient,
	configureMongoApplicationConfig,
	connectMongoDevelopment
} from '../mongodb/client';
import { verifyMongoOperationalState } from '../mongodb/verification';
import {
	assertProductionRuntimeConfig,
	preparePrivateAudioStorage,
	preparePrivateCoverImageStorage,
	preparePrivatePlaylistImageStorage
} from './config';
import { safeErrorFields, writeSafeLog } from './logging';

const STARTUP_KEY = Symbol.for('audio-library.operational-startup');
type StartupState = { promise?: Promise<void> };
const state = ((globalThis as typeof globalThis & { [STARTUP_KEY]?: StartupState })[STARTUP_KEY] ??= {});

export function initializeApplication(): Promise<void> {
	if (state.promise) return state.promise;
	const attempt = (async () => {
		assertProductionRuntimeConfig(process.env);
		const config = getServerConfig();
		configureMongoApplicationConfig(config.mongo);
		await preparePrivateAudioStorage(config.audioStoragePath);
		await preparePrivateCoverImageStorage(config.coverImageStoragePath);
		await preparePrivatePlaylistImageStorage(config.playlistImageStoragePath);
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

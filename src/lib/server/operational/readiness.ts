import { serverConfig } from '../config';
import { connectMongoDevelopment } from '../mongodb/client';
import { verifyMongoOperationalState } from '../mongodb/verification';
import { checkPrivateAudioStorage } from './config';

export const READINESS_TIMEOUT_MS = 5_000;

export interface ReadinessDependencies {
	verify(): Promise<void>;
	timeoutMs?: number;
}

function defaultReadinessDependencies(): ReadinessDependencies {
	return {
		async verify() {
			const { client, database } = await connectMongoDevelopment();
			await Promise.all([
				verifyMongoOperationalState(client, database),
				checkPrivateAudioStorage(serverConfig.audioStoragePath)
			]);
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
					() => reject(new Error('Readiness check timed out.')),
					dependencies.timeoutMs ?? READINESS_TIMEOUT_MS
				);
				timer.unref();
			})
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

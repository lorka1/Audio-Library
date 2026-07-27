export interface ShutdownResources {
	stopAccepting(): Promise<void>;
	closeListeners(): Promise<void>;
	closeSessions(): Promise<void>;
	closeMongoClient(): Promise<void>;
	closeRemaining(): Promise<void>;
	forceClose(): Promise<void>;
}

export interface ShutdownResult {
	forced: boolean;
	cleanupErrors: unknown[];
}

export class GracefulShutdown {
	readonly #resources: ShutdownResources;
	readonly #timeoutMs: number;
	#shutdownPromise: Promise<ShutdownResult> | undefined;

	constructor(resources: ShutdownResources, timeoutMs = 10_000) {
		if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
			throw new Error('Shutdown timeout must be a positive integer.');
		}
		this.#resources = resources;
		this.#timeoutMs = timeoutMs;
	}

	shutdown(): Promise<ShutdownResult> {
		if (this.#shutdownPromise) return this.#shutdownPromise;
		this.#shutdownPromise = this.#run();
		return this.#shutdownPromise;
	}

	async #run(): Promise<ShutdownResult> {
		const cleanupErrors: unknown[] = [];
		let forced = false;
		let timer: NodeJS.Timeout | undefined;
		const orderly = (async () => {
			for (const operation of [
				this.#resources.stopAccepting,
				this.#resources.closeListeners,
				this.#resources.closeSessions,
				this.#resources.closeMongoClient,
				this.#resources.closeRemaining
			]) {
				try {
					await operation();
				} catch (error) {
					cleanupErrors.push(error);
				}
			}
		})();
		const timeout = new Promise<void>((resolve) => {
			timer = setTimeout(() => {
				forced = true;
				resolve();
			}, this.#timeoutMs);
			timer.unref();
		});
		await Promise.race([orderly, timeout]);
		if (timer) clearTimeout(timer);
		if (forced) {
			try {
				await this.#resources.forceClose();
			} catch (error) {
				cleanupErrors.push(error);
			}
		} else {
			await orderly;
		}
		return { forced, cleanupErrors };
	}
}

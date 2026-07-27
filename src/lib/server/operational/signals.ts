export interface SignalTarget {
	once(signal: NodeJS.Signals, listener: () => void): unknown;
	removeListener(signal: NodeJS.Signals, listener: () => void): unknown;
}

export function installShutdownSignalHandlers(
	target: SignalTarget,
	shutdown: (signal: NodeJS.Signals) => Promise<void>,
	reportFailure: () => void
): () => void {
	const handlers = new Map<NodeJS.Signals, () => void>();
	for (const signal of ['SIGINT', 'SIGTERM'] as const) {
		const handler = () => {
			void shutdown(signal).catch(reportFailure);
		};
		handlers.set(signal, handler);
		target.once(signal, handler);
	}
	return () => {
		for (const [signal, handler] of handlers) {
			target.removeListener(signal, handler);
		}
	};
}

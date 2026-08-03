const { shutdownProductionServer } = await import('./start-production.mjs');

if (typeof process.send !== 'function') {
	throw new Error('Production runtime probe requires an owned IPC channel.');
}

let shutdownStarted = false;

async function shutdown(exitAfterShutdown = false) {
	if (shutdownStarted) return;
	shutdownStarted = true;
	try {
		await shutdownProductionServer(0);
	} catch {
		process.exitCode = 1;
	} finally {
		if (exitAfterShutdown) process.exit(1);
		else if (process.connected) process.disconnect();
	}
}

process.once('message', (message) => {
	if (message === 'shutdown') void shutdown();
});
process.once('disconnect', () => {
	void shutdown(true);
});

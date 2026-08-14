import 'dotenv/config';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { closeMongoClient, MongoClientManager } from '../src/lib/server/mongodb/client.ts';
import {
	assertProductionRuntimeConfig,
	parseOperationalConfig,
	preparePrivateAudioStorage,
	preparePrivateCoverImageStorage,
	preparePrivatePlaylistImageStorage
} from '../src/lib/server/operational/config.ts';
import { verifyMongoOperationalState } from '../src/lib/server/mongodb/verification.ts';
import { installShutdownSignalHandlers } from '../src/lib/server/operational/signals.ts';

const SHUTDOWN_TIMEOUT_MS = 10_000;
assertProductionRuntimeConfig(process.env);
const config = parseOperationalConfig(process.env);
await preparePrivateAudioStorage(config.audioStoragePath);
await preparePrivateCoverImageStorage(config.coverImageStoragePath);
await preparePrivatePlaylistImageStorage(config.playlistImageStoragePath);
const startupManager = new MongoClientManager(config.mongo);
let server;
let shutdownPromise;

function safeErrorLog(category, code) {
	const line = JSON.stringify({
		timestamp: new Date().toISOString(),
		severity: 'error',
		category,
		code
	});
	console.error(line);
}

async function preflight() {
	try {
		const client = await startupManager.connect();
		await verifyMongoOperationalState(client, client.db(config.mongo.databaseName));
	} finally {
		await startupManager.close(true);
	}
}

function shutdownProductionServer(exitCode = 0) {
	if (shutdownPromise) return shutdownPromise;
	shutdownPromise = (async () => {
		let forced = false;
		const closeListener = server
			? new Promise((resolveClose) => server.close(() => resolveClose()))
			: Promise.resolve();
		let timer;
		const timeout = new Promise((resolveTimeout) => {
			timer = setTimeout(() => {
				forced = true;
				resolveTimeout();
			}, SHUTDOWN_TIMEOUT_MS);
			timer.unref();
		});
		await Promise.race([closeListener, timeout]);
		clearTimeout(timer);
		if (forced) {
			safeErrorLog('shutdown', 'shutdown_timeout');
			server?.closeAllConnections();
		}
		await closeMongoClient(forced);
		process.exitCode = forced ? 1 : exitCode;
	})();
	return shutdownPromise;
}

async function main() {
	await preflight();
	const { handler } = await import(pathToFileURL(resolve('build/handler.js')).href);
	server = createServer(handler);
	const host = process.env.HOST?.trim() || '127.0.0.1';
	const port = Number(process.env.PORT ?? '3000');
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT is invalid.');
	await new Promise((resolveListen, rejectListen) => {
		server.once('error', rejectListen);
		server.listen(port, host, resolveListen);
	});
}

installShutdownSignalHandlers(
	process,
	() => shutdownProductionServer(0),
	() => {
		process.exitCode = 1;
	}
);

main().catch(async () => {
	safeErrorLog('configuration', 'startup_failed');
	await shutdownProductionServer(1).catch(() => undefined);
});

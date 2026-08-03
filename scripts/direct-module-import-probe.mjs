const TARGETS = Object.freeze({
	'playlist-validation': '../src/lib/server/playlists/validation.ts',
	'playlist-repository': '../src/lib/server/playlists/mongodb-repository.ts'
});
const IMPORT_TIMEOUT_MS = 10_000;
const target = process.argv[2];

if (!Object.hasOwn(TARGETS, target)) {
	console.error('DIRECT_IMPORT_PROBE_INVALID_TARGET=1');
	process.exitCode = 2;
} else {
	let timer;
	try {
		await Promise.race([
			import(new URL(TARGETS[target], import.meta.url)),
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(new Error('Direct module import timed out.')),
					IMPORT_TIMEOUT_MS
				);
			})
		]);
		console.log(`DIRECT_IMPORT_PROBE_PASSED=${target}`);
	} catch {
		console.error(`DIRECT_IMPORT_PROBE_FAILED=${target}`);
		process.exitCode = 1;
	} finally {
		if (timer) clearTimeout(timer);
	}
}

import { runVitest } from './lib/run-vitest.mjs';

try {
	process.exitCode = await runVitest(['run', ...process.argv.slice(2)]);
} catch (error) {
	console.error(error instanceof Error ? error.message : 'Unable to run the test suite.');
	process.exitCode = 1;
}

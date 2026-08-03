import { runDirectModuleImportProbe } from './lib/direct-module-import-probe-runner.mjs';

try {
	const result = await runDirectModuleImportProbe(process.argv[2]);
	console.log(result.marker);
} catch (error) {
	console.error(error instanceof Error ? error.message : 'Direct import probe failed.');
	process.exitCode = 1;
}

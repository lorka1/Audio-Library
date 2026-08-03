import { runVitest } from './lib/run-vitest.mjs';

const COVER_TEST_FILES = [
	'src/lib/components/components.test.ts',
	'src/lib/components/CoverImageField.test.ts',
	'src/lib/server/tracks/cover-files.test.ts',
	'src/lib/server/tracks/validation.test.ts',
	'src/lib/server/tracks/service.test.ts',
	'src/lib/server/tracks/management.test.ts',
	'src/lib/server/tracks/public-model.test.ts',
	'src/lib/server/tracks/owner-model.test.ts',
	'src/routes/api/tracks/[id]/cover/server.test.ts',
	'src/routes/my-tracks/[id]/edit/server.test.ts',
	'src/routes/upload/server.test.ts'
];
const TEST_FILE_SET = new Set(COVER_TEST_FILES);
const requestedArguments = process.argv.slice(2);
const requestedFiles = requestedArguments.map((argument) => argument.replaceAll('\\', '/'));
let testFiles;

if (requestedFiles.length === 0) {
	testFiles = COVER_TEST_FILES;
} else if (requestedFiles.every((file) => TEST_FILE_SET.has(file))) {
	testFiles = requestedFiles;
} else {
	console.error('Cover test runner accepts only the configured cover test files.');
	process.exitCode = 2;
	process.exit();
}

try {
	process.exitCode = await runVitest(['run', ...testFiles]);
} catch (error) {
	console.error(error instanceof Error ? error.message : 'Unable to run cover tests.');
	process.exitCode = 1;
}

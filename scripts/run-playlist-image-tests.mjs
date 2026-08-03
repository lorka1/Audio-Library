import { runVitest } from './lib/run-vitest.mjs';
import { PLAYLIST_IMAGE_TEST_FILES } from './lib/playlist-image-test-files.mjs';

try {
	process.exitCode = await runVitest(['run', ...PLAYLIST_IMAGE_TEST_FILES]);
} catch (error) {
	console.error(error instanceof Error ? error.message : 'Unable to run playlist-image tests.');
	process.exitCode = 1;
}

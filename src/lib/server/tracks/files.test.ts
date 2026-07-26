import { readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AUDIO_FORMATS,
	closeOpenedAudioFile,
	createAudioWebStream,
	deleteQuarantinedAudioFile,
	deleteStoredAudioFile,
	ensureAudioStorageDirectory,
	generateStoredFilename,
	getSafeAudioResponseMimeType,
	getValidatedAudioExtension,
	isAllowedAudioFormat,
	normalizeAudioExtension,
	openStoredAudioFile,
	quarantineStoredAudioFile,
	resolveStorageFilePath,
	restoreQuarantinedAudioFile,
	saveAudioFile
} from './files';

const TEST_UUID = '550e8400-e29b-41d4-a716-446655440000';
const STORED_FILENAME_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:mp3|wav|ogg)$/;

describe('audio file storage helpers', () => {
	let temporaryRoot: string;

	beforeEach(async () => {
		temporaryRoot = await mkdtemp(join(tmpdir(), 'audio-library-files-'));
	});

	afterEach(async () => {
		await rm(temporaryRoot, { force: true, recursive: true });
	});

	describe('format validation', () => {
		it('defines the supported extension and MIME type mapping', () => {
			expect(AUDIO_FORMATS).toEqual({
				'.mp3': ['audio/mpeg'],
				'.wav': ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'],
				'.ogg': ['audio/ogg']
			});
		});

		it('normalizes supported extensions and rejects unsupported extensions', () => {
			expect(normalizeAudioExtension(' .MP3 ')).toBe('.mp3');
			expect(normalizeAudioExtension('.flac')).toBeNull();
		});

		it.each([
			['.mp3', 'audio/mpeg'],
			['.wav', 'audio/wav'],
			['.wav', 'audio/x-wav'],
			['.wav', 'audio/wave'],
			['.wav', 'audio/vnd.wave'],
			['.ogg', 'audio/ogg']
		])('accepts %s with %s', (extension, mimeType) => {
			expect(isAllowedAudioFormat(extension, mimeType)).toBe(true);
		});

		it('normalizes MIME type casing and surrounding whitespace', () => {
			expect(isAllowedAudioFormat('.WAV', ' AUDIO/X-WAV ')).toBe(true);
		});

		it.each([
			['.mp3', 'audio/ogg'],
			['.wav', 'audio/mpeg'],
			['.ogg', 'application/ogg'],
			['.flac', 'audio/flac'],
			['.mp3', 'audio/mpeg; codecs=mp3']
		])('rejects the unsupported combination %s with %s', (extension, mimeType) => {
			expect(isAllowedAudioFormat(extension, mimeType)).toBe(false);
		});

		it('derives only an extension whose MIME type matches', () => {
			expect(getValidatedAudioExtension('recording.MP3', 'audio/mpeg')).toBe('.mp3');
			expect(getValidatedAudioExtension('recording.mp3', 'audio/ogg')).toBeNull();
			expect(getValidatedAudioExtension('recording.mp3.exe', 'audio/mpeg')).toBeNull();
		});

		it('uses only validated audio MIME types in responses', () => {
			expect(getSafeAudioResponseMimeType(`${TEST_UUID}.mp3`, 'audio/mpeg')).toBe(
				'audio/mpeg'
			);
			expect(
				getSafeAudioResponseMimeType(`${TEST_UUID}.mp3`, 'text/html\r\nX-Evil: yes')
			).toBe('application/octet-stream');
		});
	});

	describe('stored filenames', () => {
		it('uses the supplied UUID and a normalized supported extension', () => {
			expect(generateStoredFilename('.MP3', TEST_UUID.toUpperCase())).toBe(
				`${TEST_UUID}.mp3`
			);
		});

		it('generates a version 4 UUID filename without original filename content', () => {
			const storedFilename = generateStoredFilename('.ogg');

			expect(storedFilename).toMatch(STORED_FILENAME_PATTERN);
			expect(storedFilename).not.toContain('original-track');
		});

		it('rejects unsupported extensions', () => {
			expect(() => generateStoredFilename('.flac', TEST_UUID)).toThrow(
				'Unsupported audio file extension.'
			);
		});

		it.each([
			'not-a-uuid',
			'550e8400-e29b-11d4-a716-446655440000',
			'550e8400-e29b-41d4-7716-446655440000',
			'../../550e8400-e29b-41d4-a716-446655440000'
		])('rejects an invalid or non-v4 UUID: %s', (uuid) => {
			expect(() => generateStoredFilename('.mp3', uuid)).toThrow(
				'A valid version 4 UUID is required for the stored filename.'
			);
		});
	});

	describe('storage paths', () => {
		it('resolves a valid stored filename inside the absolute storage root', () => {
			const storedFilename = generateStoredFilename('.wav', TEST_UUID);
			const filePath = resolveStorageFilePath(temporaryRoot, storedFilename);
			const pathWithinRoot = relative(resolve(temporaryRoot), filePath);

			expect(isAbsolute(filePath)).toBe(true);
			expect(filePath).toBe(resolve(temporaryRoot, storedFilename));
			expect(pathWithinRoot).not.toBe('..');
			expect(pathWithinRoot.startsWith(`..${sep}`)).toBe(false);
			expect(isAbsolute(pathWithinRoot)).toBe(false);
		});

		it.each([
			'../550e8400-e29b-41d4-a716-446655440000.mp3',
			'folder/550e8400-e29b-41d4-a716-446655440000.mp3',
			'folder\\550e8400-e29b-41d4-a716-446655440000.mp3',
			'C:\\550e8400-e29b-41d4-a716-446655440000.mp3',
			'/tmp/550e8400-e29b-41d4-a716-446655440000.mp3',
			'.gitkeep',
			'550e8400-e29b-41d4-a716-446655440000.mp3.exe'
		])('rejects an unsafe or invalid stored filename: %s', (storedFilename) => {
			expect(() => resolveStorageFilePath(temporaryRoot, storedFilename)).toThrow(
				'Invalid stored audio filename.'
			);
		});

		it('rejects an empty storage root instead of resolving it to the process directory', () => {
			const storedFilename = generateStoredFilename('.mp3', TEST_UUID);

			expect(() => resolveStorageFilePath('  ', storedFilename)).toThrow(
				'The audio storage root must not be empty.'
			);
		});

		it('creates a missing nested storage directory', async () => {
			const nestedRoot = join(temporaryRoot, 'private', 'audio');

			await expect(ensureAudioStorageDirectory(nestedRoot)).resolves.toBe(resolve(nestedRoot));
			await expect(stat(nestedRoot)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
			expect((await stat(nestedRoot)).isDirectory()).toBe(true);
		});
	});

	describe('writing and deleting files', () => {
		it('writes an MP3 exclusively and reports its actual byte length', async () => {
			const bytes = new Uint8Array([0x49, 0x44, 0x33, 0x04]);
			const file = new File([bytes], 'original-track.mp3', { type: 'audio/mpeg' });

			const result = await saveAudioFile(file, '.mp3', temporaryRoot);
			const savedPath = resolveStorageFilePath(temporaryRoot, result.storedFilename);

			expect(result.storedFilename).toMatch(/\.mp3$/);
			expect(result.storedFilename).not.toContain('original-track');
			expect(result.fileSizeBytes).toBe(bytes.byteLength);
			expect(new Uint8Array(await readFile(savedPath))).toEqual(bytes);
			expect((await stat(savedPath)).isFile()).toBe(true);
		});

		it.each([
			['audio/wav', '.wav'],
			['audio/x-wav', '.wav'],
			['audio/wave', '.wav'],
			['audio/vnd.wave', '.wav'],
			['audio/ogg', '.ogg']
		] as const)('writes a file with MIME type %s and extension %s', async (mimeType, extension) => {
			const file = new File([new Uint8Array([1, 2, 3])], `track${extension}`, {
				type: mimeType
			});

			const result = await saveAudioFile(file, extension, temporaryRoot);

			expect(result.storedFilename.endsWith(extension)).toBe(true);
			expect(result.fileSizeBytes).toBe(3);
		});

		it('rejects an extension and MIME mismatch without writing a file', async () => {
			const file = new File([new Uint8Array([1])], 'track.mp3', { type: 'audio/ogg' });

			await expect(saveAudioFile(file, '.mp3', temporaryRoot)).rejects.toThrow(
				'The audio extension and MIME type do not match.'
			);
			expect(await readdir(temporaryRoot)).toEqual([]);
		});

		it('rejects an empty file without writing it', async () => {
			const file = new File([], 'empty.mp3', { type: 'audio/mpeg' });

			await expect(saveAudioFile(file, '.mp3', temporaryRoot)).rejects.toThrow(
				'The audio file must not be empty.'
			);
			expect(await readdir(temporaryRoot)).toEqual([]);
		});

		it('rejects a reported size that differs from the bytes read', async () => {
			class InconsistentFile extends File {
				override get size(): number {
					return super.size + 1;
				}
			}

			const file = new InconsistentFile([new Uint8Array([1, 2])], 'track.ogg', {
				type: 'audio/ogg'
			});

			await expect(saveAudioFile(file, '.ogg', temporaryRoot)).rejects.toThrow(
				'The audio file size changed while it was being read.'
			);
			expect(await readdir(temporaryRoot)).toEqual([]);
		});

		it('deletes a saved file and treats a repeated deletion as successful', async () => {
			const file = new File([new Uint8Array([1])], 'track.ogg', { type: 'audio/ogg' });
			const result = await saveAudioFile(file, '.ogg', temporaryRoot);

			await expect(
				deleteStoredAudioFile(result.storedFilename, temporaryRoot)
			).resolves.toBeUndefined();
			await expect(
				deleteStoredAudioFile(result.storedFilename, temporaryRoot)
			).resolves.toBeUndefined();
			expect(await readdir(temporaryRoot)).toEqual([]);
		});

		it('logs only sanitized metadata when deletion fails unexpectedly', async () => {
			const storedFilename = generateStoredFilename('.mp3', TEST_UUID);
			await mkdir(resolveStorageFilePath(temporaryRoot, storedFilename));
			const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

			await expect(
				deleteStoredAudioFile(storedFilename, temporaryRoot)
			).rejects.toBeDefined();

			expect(consoleError).toHaveBeenCalledOnce();
			const serializedLogArguments = JSON.stringify(consoleError.mock.calls[0]);
			expect(serializedLogArguments).toContain('errorType');
			expect(serializedLogArguments).not.toContain(temporaryRoot);
			expect(serializedLogArguments).not.toContain(storedFilename);
			consoleError.mockRestore();
		});

		it('quarantines and restores a regular file inside the same storage root', async () => {
			const storedFilename = generateStoredFilename('.mp3', TEST_UUID);
			const originalPath = resolveStorageFilePath(temporaryRoot, storedFilename);
			const bytes = new Uint8Array([1, 2, 3, 4]);
			await writeFile(originalPath, bytes);

			const quarantined = await quarantineStoredAudioFile(
				storedFilename,
				temporaryRoot
			);

			expect(quarantined.success).toBe(true);
			if (!quarantined.success || quarantined.state !== 'quarantined') {
				throw new Error('Expected the stored audio file to be quarantined.');
			}

			expect(await readdir(temporaryRoot)).toEqual([
				expect.stringMatching(/^\.delete-[0-9a-f-]+\.tmp$/)
			]);
			await restoreQuarantinedAudioFile(quarantined.file);
			expect(new Uint8Array(await readFile(originalPath))).toEqual(bytes);
			expect(await readdir(temporaryRoot)).toEqual([storedFilename]);
		});

		it('permanently removes a quarantined file without leaving a temporary name', async () => {
			const storedFilename = generateStoredFilename('.ogg', TEST_UUID);
			await writeFile(
				resolveStorageFilePath(temporaryRoot, storedFilename),
				new Uint8Array([1, 2])
			);
			const quarantined = await quarantineStoredAudioFile(
				storedFilename,
				temporaryRoot
			);

			if (!quarantined.success || quarantined.state !== 'quarantined') {
				throw new Error('Expected the stored audio file to be quarantined.');
			}

			await deleteQuarantinedAudioFile(quarantined.file);
			await expect(
				deleteQuarantinedAudioFile(quarantined.file)
			).resolves.toBeUndefined();
			expect(await readdir(temporaryRoot)).toEqual([]);
		});

		it('treats a missing file as already removed', async () => {
			await expect(
				quarantineStoredAudioFile(`${TEST_UUID}.wav`, temporaryRoot)
			).resolves.toEqual({ success: true, state: 'missing' });
		});

		it.each([
			`../${TEST_UUID}.mp3`,
			`folder/${TEST_UUID}.mp3`,
			`${TEST_UUID}.mp3.exe`
		])('fails closed for unsafe stored filename %s', async (storedFilename) => {
			const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

			const result = await quarantineStoredAudioFile(
				storedFilename,
				temporaryRoot
			);

			expect(result).toEqual({ success: false, reason: 'unsafe' });
			expect(JSON.stringify(result)).not.toContain(temporaryRoot);
			consoleError.mockRestore();
		});

		it('rejects a directory instead of deleting it', async () => {
			const storedFilename = `${TEST_UUID}.mp3`;
			await mkdir(resolveStorageFilePath(temporaryRoot, storedFilename));

			await expect(
				quarantineStoredAudioFile(storedFilename, temporaryRoot)
			).resolves.toEqual({ success: false, reason: 'not-file' });
			expect((await stat(resolveStorageFilePath(temporaryRoot, storedFilename))).isDirectory())
				.toBe(true);
		});

		it('rejects a symbolic link without touching its target', async () => {
			const storedFilename = `${TEST_UUID}.mp3`;
			const targetDirectory = join(temporaryRoot, 'target');
			const targetFile = join(targetDirectory, 'target.mp3');
			await mkdir(targetDirectory);
			await writeFile(targetFile, new Uint8Array([9, 8, 7]));
			await symlink(
				targetDirectory,
				resolveStorageFilePath(temporaryRoot, storedFilename),
				'junction'
			);

			await expect(
				quarantineStoredAudioFile(storedFilename, temporaryRoot)
			).resolves.toEqual({ success: false, reason: 'not-file' });
			expect(new Uint8Array(await readFile(targetFile))).toEqual(
				new Uint8Array([9, 8, 7])
			);
		});
	});

	describe('read stream support', () => {
		it('opens a regular file and streams all bytes through a web Response', async () => {
			const bytes = new Uint8Array([0, 1, 2, 3, 4, 5]);
			const saved = await saveAudioFile(
				new File([bytes], 'stream.mp3', { type: 'audio/mpeg' }),
				'.mp3',
				temporaryRoot
			);
			const opened = await openStoredAudioFile(saved.storedFilename, temporaryRoot);

			expect(opened.success).toBe(true);

			if (opened.success) {
				expect(opened.file.fileSizeBytes).toBe(bytes.byteLength);
				const response = new Response(createAudioWebStream(opened.file));
				expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
			}
		});

		it('streams an inclusive start and end range', async () => {
			const bytes = new Uint8Array([10, 11, 12, 13, 14]);
			const saved = await saveAudioFile(
				new File([bytes], 'partial.ogg', { type: 'audio/ogg' }),
				'.ogg',
				temporaryRoot
			);
			const opened = await openStoredAudioFile(saved.storedFilename, temporaryRoot);

			if (!opened.success) {
				throw new Error('Expected the temporary audio file to open.');
			}

			const response = new Response(
				createAudioWebStream(opened.file, { start: 1, end: 3 })
			);
			expect(new Uint8Array(await response.arrayBuffer())).toEqual(
				new Uint8Array([11, 12, 13])
			);
		});

		it('returns safe missing and non-file results without path data', async () => {
			const missingFilename = `${TEST_UUID}.mp3`;
			const missing = await openStoredAudioFile(missingFilename, temporaryRoot);

			expect(missing).toEqual({ success: false, reason: 'missing' });
			expect(JSON.stringify(missing)).not.toContain(temporaryRoot);
			expect(JSON.stringify(missing)).not.toContain(missingFilename);

			await mkdir(resolveStorageFilePath(temporaryRoot, missingFilename));
			const directory = await openStoredAudioFile(missingFilename, temporaryRoot);
			expect(directory).toEqual({ success: false, reason: 'not-file' });
			expect(JSON.stringify(directory)).not.toContain(temporaryRoot);
		});

		it('allows an early-return handle to be closed before deletion', async () => {
			const saved = await saveAudioFile(
				new File([new Uint8Array([1, 2])], 'close.wav', { type: 'audio/wav' }),
				'.wav',
				temporaryRoot
			);
			const opened = await openStoredAudioFile(saved.storedFilename, temporaryRoot);

			if (!opened.success) {
				throw new Error('Expected the temporary audio file to open.');
			}

			await closeOpenedAudioFile(opened.file);
			await expect(
				deleteStoredAudioFile(saved.storedFilename, temporaryRoot)
			).resolves.toBeUndefined();
		});
	});
});

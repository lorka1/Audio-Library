import { describe, expect, it } from 'vitest';
import { MUSIC_GENRES, MUSICAL_KEYS } from '$lib/constants/music';
import {
	BPM_MAX,
	BPM_MIN,
	ORIGINAL_FILENAME_MAX_LENGTH,
	TRACK_DESCRIPTION_MAX_LENGTH,
	TRACK_TITLE_MAX_LENGTH,
	readUploadFormValues,
	validateAudioFile,
	validateBpm,
	validateCoverImageFile,
	validateDescription,
	validateGenre,
	validateMusicalKey,
	validateTrackEditFormData,
	validateTrackMetadataFormData,
	validateTitle,
	validateUploadFormData
} from './validation';

const TINY_FILE_LIMIT_BYTES = 4;

function audioFile(
	name = 'test-track.mp3',
	type = 'audio/mpeg',
	size = TINY_FILE_LIMIT_BYTES
): File {
	return new File([new Uint8Array(size)], name, { type });
}

function validUploadFormData(file: File = audioFile()): FormData {
	const formData = new FormData();
	formData.set('title', 'Test Track');
	formData.set('bpm', '120');
	formData.set('musicalKey', 'C major');
	formData.set('genre', 'Electronic');
	formData.set('description', 'A synthetic test track.');
	formData.set('audioFile', file);
	return formData;
}

describe('track title validation', () => {
	it('trims a valid title', () => {
		expect(validateTitle('  Test Track  ')).toEqual({
			value: 'Test Track',
			error: null
		});
	});

	it('rejects an empty or whitespace-only title', () => {
		expect(validateTitle('   ')).toEqual({
			value: '',
			error: 'Title is required.'
		});
	});

	it('accepts the maximum title length and rejects one character more', () => {
		expect(validateTitle('T'.repeat(TRACK_TITLE_MAX_LENGTH)).error).toBeNull();
		expect(validateTitle('T'.repeat(TRACK_TITLE_MAX_LENGTH + 1)).error).toBe(
			`Title must be at most ${TRACK_TITLE_MAX_LENGTH} characters.`
		);
	});
});

describe('BPM validation', () => {
	it('accepts and trims a valid BPM', () => {
		expect(validateBpm(' 120 ')).toEqual({ value: 120, error: null });
	});

	it('converts an empty BPM to null', () => {
		expect(validateBpm('   ')).toEqual({ value: null, error: null });
	});

	it('accepts both inclusive BPM boundaries', () => {
		expect(validateBpm(String(BPM_MIN))).toEqual({ value: BPM_MIN, error: null });
		expect(validateBpm(String(BPM_MAX))).toEqual({ value: BPM_MAX, error: null });
	});

	it('rejects a BPM below the minimum', () => {
		expect(validateBpm(String(BPM_MIN - 1))).toEqual({
			value: null,
			error: `BPM must be between ${BPM_MIN} and ${BPM_MAX}.`
		});
	});

	it('rejects a BPM above the maximum', () => {
		expect(validateBpm(String(BPM_MAX + 1))).toEqual({
			value: null,
			error: `BPM must be between ${BPM_MIN} and ${BPM_MAX}.`
		});
	});

	it.each(['120.5', '120.0', '1e2'])('rejects a non-integer numeric spelling: %s', (bpm) => {
		expect(validateBpm(bpm)).toEqual({
			value: null,
			error: 'BPM must be an integer.'
		});
	});

	it.each(['+120', '-120', '0120'])('rejects a noncanonical integer spelling: %s', (bpm) => {
		expect(validateBpm(bpm)).toEqual({
			value: null,
			error: 'BPM must be an integer.'
		});
	});

	it('rejects textual BPM input', () => {
		expect(validateBpm('fast')).toEqual({
			value: null,
			error: 'BPM must be an integer.'
		});
	});
});

describe('musical key validation', () => {
	it.each(MUSICAL_KEYS)('accepts the centralized musical key: %s', (musicalKey) => {
		expect(validateMusicalKey(` ${musicalKey} `)).toEqual({
			value: musicalKey,
			error: null
		});
	});

	it('converts an empty musical key to null', () => {
		expect(validateMusicalKey('   ')).toEqual({ value: null, error: null });
	});

	it.each(['H major', 'c major', 'C major<script>'])(
		'rejects a forged musical key: %s',
		(musicalKey) => {
			expect(validateMusicalKey(musicalKey)).toEqual({
				value: null,
				error: 'Select a valid musical key.'
			});
		}
	);
});

describe('genre validation', () => {
	it.each(MUSIC_GENRES)('accepts the centralized genre: %s', (genre) => {
		expect(validateGenre(` ${genre} `)).toEqual({
			value: genre,
			error: null
		});
	});

	it('converts an empty genre to null', () => {
		expect(validateGenre('   ')).toEqual({ value: null, error: null });
	});

	it.each(['Country', 'electronic', 'Rock<script>'])('rejects a forged genre: %s', (genre) => {
		expect(validateGenre(genre)).toEqual({
			value: null,
			error: 'Select a valid genre.'
		});
	});
});

describe('description validation', () => {
	it('trims a valid description', () => {
		expect(validateDescription('  A test description.  ')).toEqual({
			value: 'A test description.',
			error: null
		});
	});

	it('converts an empty description to null', () => {
		expect(validateDescription('   ')).toEqual({ value: null, error: null });
	});

	it('accepts the maximum description length and rejects one character more', () => {
		expect(validateDescription('D'.repeat(TRACK_DESCRIPTION_MAX_LENGTH)).error).toBeNull();
		expect(validateDescription('D'.repeat(TRACK_DESCRIPTION_MAX_LENGTH + 1))).toEqual({
			value: null,
			error: `Description must be at most ${TRACK_DESCRIPTION_MAX_LENGTH} characters.`
		});
	});
});

describe('audio file validation', () => {
	it('rejects null and non-File form values', () => {
		expect(validateAudioFile(null, TINY_FILE_LIMIT_BYTES)).toEqual({
			value: null,
			error: 'Audio file is required.'
		});
		expect(validateAudioFile('test-track.mp3', TINY_FILE_LIMIT_BYTES)).toEqual({
			value: null,
			error: 'Audio file is required.'
		});
	});

	it('rejects a File without a name', () => {
		expect(validateAudioFile(audioFile('', 'audio/mpeg'), TINY_FILE_LIMIT_BYTES)).toEqual({
			value: null,
			error: 'Audio file is required.'
		});
	});

	it('rejects an empty audio file', () => {
		expect(validateAudioFile(audioFile('empty.mp3', 'audio/mpeg', 0), TINY_FILE_LIMIT_BYTES)).toEqual(
			{
				value: null,
				error: 'Audio file must not be empty.'
			}
		);
	});

	it('accepts a file exactly at the size limit', () => {
		const file = audioFile('exact.mp3', 'audio/mpeg', TINY_FILE_LIMIT_BYTES);
		const result = validateAudioFile(file, TINY_FILE_LIMIT_BYTES);

		expect(result.error).toBeNull();
		expect(result.value).toMatchObject({
			file,
			extension: '.mp3',
			originalFilename: 'exact.mp3',
			mimeType: 'audio/mpeg'
		});
	});

	it('rejects a file one byte over the size limit', () => {
		const result = validateAudioFile(
			audioFile('large.mp3', 'audio/mpeg', TINY_FILE_LIMIT_BYTES + 1),
			TINY_FILE_LIMIT_BYTES
		);

		expect(result.value).toBeNull();
		expect(result.error).toContain('must not be larger than');
	});

	it('accepts an MP3 extension paired with its MIME type', () => {
		expect(validateAudioFile(audioFile('track.mp3', 'audio/mpeg'), TINY_FILE_LIMIT_BYTES).value)
			.toMatchObject({
				extension: '.mp3',
				mimeType: 'audio/mpeg'
			});
	});

	it.each(['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'])(
		'accepts a WAV extension paired with %s',
		(mimeType) => {
			expect(validateAudioFile(audioFile('track.wav', mimeType), TINY_FILE_LIMIT_BYTES).value)
				.toMatchObject({
					extension: '.wav',
					mimeType
				});
		}
	);

	it('accepts an OGG extension paired with its MIME type', () => {
		expect(validateAudioFile(audioFile('track.ogg', 'audio/ogg'), TINY_FILE_LIMIT_BYTES).value)
			.toMatchObject({
				extension: '.ogg',
				mimeType: 'audio/ogg'
			});
	});

	it.each([
		['track.mp3', 'audio/wav'],
		['track.wav', 'audio/mpeg'],
		['track.ogg', 'audio/mpeg'],
		['track.txt', 'audio/mpeg'],
		['track.mp3', 'application/pdf'],
		['track.mp3', '']
	])('rejects an unsupported extension and MIME combination: %s / %s', (name, mimeType) => {
		const result = validateAudioFile(audioFile(name, mimeType), TINY_FILE_LIMIT_BYTES);

		expect(result).toEqual({
			value: null,
			error: 'Unsupported audio format. Upload an MP3, WAV, or OGG file.'
		});
	});

	it('normalizes an uppercase supported extension', () => {
		expect(validateAudioFile(audioFile('TRACK.MP3', 'audio/mpeg'), TINY_FILE_LIMIT_BYTES).value)
			.toMatchObject({
				extension: '.mp3',
				originalFilename: 'TRACK.MP3'
			});
	});

	it('uses only the final extension of a filename', () => {
		expect(
			validateAudioFile(audioFile('archive.wav.mp3', 'audio/mpeg'), TINY_FILE_LIMIT_BYTES).value
		).toMatchObject({
			extension: '.mp3',
			originalFilename: 'archive.wav.mp3'
		});

		expect(
			validateAudioFile(audioFile('archive.mp3.exe', 'audio/mpeg'), TINY_FILE_LIMIT_BYTES)
		).toEqual({
			value: null,
			error: 'Unsupported audio format. Upload an MP3, WAV, or OGG file.'
		});
	});

	it('enforces the original filename length boundary', () => {
		const acceptedName = `${'a'.repeat(ORIGINAL_FILENAME_MAX_LENGTH - 4)}.mp3`;
		const rejectedName = `${'a'.repeat(ORIGINAL_FILENAME_MAX_LENGTH - 3)}.mp3`;

		expect(
			validateAudioFile(audioFile(acceptedName, 'audio/mpeg'), TINY_FILE_LIMIT_BYTES).error
		).toBeNull();
		expect(
			validateAudioFile(audioFile(rejectedName, 'audio/mpeg'), TINY_FILE_LIMIT_BYTES)
		).toEqual({
			value: null,
			error: `Audio filename must be at most ${ORIGINAL_FILENAME_MAX_LENGTH} characters.`
		});
	});
});

describe('metadata-only form validation', () => {
	it('validates editable metadata without requiring an audio file', () => {
		const formData = validUploadFormData();
		formData.delete('audioFile');

		const result = validateTrackMetadataFormData(formData);

		expect(result).toEqual({
			success: true,
			values: {
				title: 'Test Track',
				bpm: '120',
				musicalKey: 'C major',
				genre: 'Electronic',
				description: 'A synthetic test track.'
			},
			metadata: {
				title: 'Test Track',
				bpm: 120,
				musicalKey: 'C major',
				genre: 'Electronic',
				description: 'A synthetic test track.'
			}
		});
	});

	it('preserves bounded safe values and ignores forged ownership fields', () => {
		const formData = validUploadFormData();
		formData.delete('audioFile');
		formData.set('title', '   ');
		formData.set('bpm', '120.5');
		formData.set('musicalKey', 'forged');
		formData.set('genre', 'forged');
		formData.set('description', 'D'.repeat(TRACK_DESCRIPTION_MAX_LENGTH + 1));
		formData.set('ownerId', 'forged-owner');
		formData.set('visibility', 'private');
		formData.set('storageKey', '../secret.mp3');
		formData.set('artist', 'forged attribution');

		const result = validateTrackMetadataFormData(formData);

		expect(result.success).toBe(false);

		if (!result.success) {
			expect(result.values).toMatchObject({
				title: '',
				bpm: '120.5',
				musicalKey: 'forged',
				genre: 'forged'
			});
			expect(result.values).not.toHaveProperty('ownerId');
			expect(result.values).not.toHaveProperty('visibility');
			expect(result.values).not.toHaveProperty('storageKey');
			expect(result.values).not.toHaveProperty('artist');
			expect(result.errors).toMatchObject({
				title: 'Title is required.',
				bpm: 'BPM must be an integer.',
				musicalKey: 'Select a valid musical key.',
				genre: 'Select a valid genre.',
				description: `Description must be at most ${TRACK_DESCRIPTION_MAX_LENGTH} characters.`
			});
		}
	});
});

describe('complete upload form validation', () => {
	it('returns normalized metadata for a valid form', () => {
		const formData = validUploadFormData();
		formData.set('title', '  Test Track  ');
		formData.set('artist', '  Forged Artist  ');
		formData.set('bpm', ' 120 ');
		formData.set('musicalKey', ' C major ');
		formData.set('genre', ' Electronic ');
		formData.set('description', '  A synthetic test track.  ');

		const result = validateUploadFormData(formData, TINY_FILE_LIMIT_BYTES);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.values).toEqual({
				title: 'Test Track',
				bpm: '120',
				musicalKey: 'C major',
				genre: 'Electronic',
				description: 'A synthetic test track.'
			});
			expect(result.metadata).toEqual({
				title: 'Test Track',
				bpm: 120,
				musicalKey: 'C major',
				genre: 'Electronic',
				description: 'A synthetic test track.'
			});
			expect(result.values).not.toHaveProperty('artist');
			expect(result.metadata).not.toHaveProperty('artist');
		}
	});

	it('returns null for valid empty optional metadata', () => {
		const formData = validUploadFormData();
		formData.set('bpm', ' ');
		formData.set('musicalKey', ' ');
		formData.set('genre', ' ');
		formData.set('description', ' ');

		const result = validateUploadFormData(formData, TINY_FILE_LIMIT_BYTES);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.metadata).toMatchObject({
				bpm: null,
				musicalKey: null,
				genre: null,
				description: null
			});
		}
	});

	it('treats a File posted in a text field as missing text', () => {
		const formData = validUploadFormData();
		formData.set('title', audioFile());

		expect(readUploadFormValues(formData).title).toBe('');

		const result = validateUploadFormData(formData, TINY_FILE_LIMIT_BYTES);
		expect(result.success).toBe(false);

		if (!result.success) {
			expect(result.errors.title).toBe('Title is required.');
			expect(result.values.title).toBe('');
		}
	});

	it('retains only safe trimmed text values and never returns the File after validation fails', () => {
		const formData = validUploadFormData(audioFile('not-audio.txt', 'text/plain'));
		formData.set('title', '  Retained title  ');
		formData.set('artist', '  Forged artist  ');
		formData.set('bpm', ' 120.5 ');
		formData.set('musicalKey', ' C major ');
		formData.set('genre', ' Electronic ');
		formData.set('description', '  Retained description  ');

		const result = validateUploadFormData(formData, TINY_FILE_LIMIT_BYTES);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.values).toEqual({
				title: 'Retained title',
				bpm: '120.5',
				musicalKey: 'C major',
				genre: 'Electronic',
				description: 'Retained description'
			});
			expect(result.values).not.toHaveProperty('artist');
			expect(Object.values(result.values).every((value) => typeof value === 'string')).toBe(true);
			expect(result).not.toHaveProperty('audioFile');
			expect(result.errors).toMatchObject({
				bpm: 'BPM must be an integer.',
				audioFile: 'Unsupported audio format. Upload an MP3, WAV, or OGG file.'
			});
		}
	});
});

describe('optional cover image validation', () => {
	it('treats a missing or empty browser file as an omitted optional cover', () => {
		expect(validateCoverImageFile(null, 1024)).toEqual({
			value: null,
			error: null
		});
		expect(
			validateCoverImageFile(
				new File([], '', { type: 'application/octet-stream' }),
				1024
			)
		).toEqual({ value: null, error: null });
	});

	it.each([
		['cover.jpg', 'image/jpeg'],
		['cover.jpeg', 'image/jpeg'],
		['cover.png', 'image/png'],
		['cover.webp', 'image/webp']
	])('accepts supported extension and MIME pairs: %s', (name, type) => {
		const result = validateCoverImageFile(
			new File([new Uint8Array([1, 2, 3, 4])], name, { type }),
			4
		);
		expect(result.error).toBeNull();
		expect(result.value?.mimeType).toBe(type);
	});

	it.each([
		['cover.svg', 'image/svg+xml'],
		['cover.png', 'image/jpeg'],
		['cover.exe', 'image/png'],
		['cover.png.exe', 'image/png']
	])('rejects unsafe or mismatched cover input: %s', (name, type) => {
		expect(
			validateCoverImageFile(
				new File([new Uint8Array([1])], name, { type }),
				4
			).error
		).toContain('Unsupported cover image format');
	});

	it('rejects an oversize cover with a bounded user-facing error', () => {
		const result = validateCoverImageFile(
			new File([new Uint8Array(5)], 'cover.png', { type: 'image/png' }),
			4
		);
		expect(result.error).toBe('Cover image must not be larger than 0 MB.');
	});

	it('includes an optional validated cover in a complete upload result', () => {
		const formData = validUploadFormData();
		formData.set(
			'coverImage',
			new File([new Uint8Array([1, 2, 3, 4])], 'cover.webp', {
				type: 'image/webp'
			})
		);
		const result = validateUploadFormData(
			formData,
			TINY_FILE_LIMIT_BYTES,
			TINY_FILE_LIMIT_BYTES
		);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.coverImage).toMatchObject({
				extension: '.webp',
				mimeType: 'image/webp'
			});
		}
	});

	it('parses retain, replace, and remove edit operations without trusting forged values', () => {
		const retain = validateTrackEditFormData(validUploadFormData(), 1024);
		expect(retain.success && retain.coverOperation).toEqual({ kind: 'retain' });

		const replaceForm = validUploadFormData();
		replaceForm.set(
			'coverImage',
			new File([new Uint8Array([1])], 'cover.png', { type: 'image/png' })
		);
		const replace = validateTrackEditFormData(replaceForm, 1024);
		expect(replace.success && replace.coverOperation.kind).toBe('replace');

		const removeForm = validUploadFormData();
		removeForm.set('removeCoverImage', '1');
		const remove = validateTrackEditFormData(removeForm, 1024);
		expect(remove.success && remove.coverOperation).toEqual({ kind: 'remove' });

		removeForm.set(
			'coverImage',
			new File([new Uint8Array([1])], 'cover.png', { type: 'image/png' })
		);
		const conflict = validateTrackEditFormData(removeForm, 1024);
		expect(conflict).toMatchObject({
			success: false,
			errors: {
				coverImage: 'Choose either a replacement cover image or removal, not both.'
			}
		});
	});
});

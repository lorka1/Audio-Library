import { describe, expect, it } from 'vitest';
import {
	isValidPlaylistPublicId,
	PLAYLIST_DESCRIPTION_MAX_LENGTH,
	PLAYLIST_NAME_MAX_LENGTH,
	validatePlaylistFormData
} from './validation';

function form(name: string, description = ''): FormData {
	const data = new FormData();
	data.set('name', name);
	data.set('description', description);
	return data;
}

describe('playlist validation', () => {
	it('trims a name and normalizes an empty description to null', () => {
		expect(validatePlaylistFormData(form('  Focus mix  ', '   '))).toEqual({
			success: true,
			values: { name: 'Focus mix', description: '', removeImage: false },
			input: { name: 'Focus mix', description: null },
			imageOperation: { kind: 'retain' }
		});
	});

	it('accepts matching JPEG, PNG, and WebP metadata and rejects mismatches and oversized images', () => {
		for (const [name, type] of [['art.jpg', 'image/jpeg'], ['art.png', 'image/png'], ['art.webp', 'image/webp']]) {
			const data = form('Image mix');
			data.set('image', new File([new Uint8Array([1])], name, { type }));
			expect(validatePlaylistFormData(data, 10).success).toBe(true);
		}
		const mismatch = form('Mismatch');
		mismatch.set('image', new File([new Uint8Array([1])], 'art.png', { type: 'image/jpeg' }));
		const mismatchResult = validatePlaylistFormData(mismatch, 10);
		expect(mismatchResult.success).toBe(false);
		if (!mismatchResult.success) expect(mismatchResult.errors.image).toContain('Unsupported');
		const oversized = form('Oversized');
		oversized.set('image', new File([new Uint8Array(11)], 'art.png', { type: 'image/png' }));
		expect(validatePlaylistFormData(oversized, 10).success).toBe(false);
	});

	it('preserves explicit removal state through unrelated validation errors', () => {
		const data = form('');
		data.set('removeImage', 'true');
		const result = validatePlaylistFormData(data, 10, true);
		expect(result.success).toBe(false);
		if (!result.success) expect(result.values.removeImage).toBe(true);
	});

	it('rejects empty and oversized names with field-specific errors', () => {
		const empty = validatePlaylistFormData(form('   '));
		expect(empty.success).toBe(false);
		if (!empty.success) expect(empty.errors.name).toBe('Enter a playlist name.');

		const oversized = validatePlaylistFormData(form('x'.repeat(PLAYLIST_NAME_MAX_LENGTH + 1)));
		expect(oversized.success).toBe(false);
		if (!oversized.success) expect(oversized.errors.name).toContain('80');
	});

	it('rejects oversized descriptions and retains safe entered values', () => {
		const result = validatePlaylistFormData(
			form('Synthetic playlist', 'x'.repeat(PLAYLIST_DESCRIPTION_MAX_LENGTH + 1))
		);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.errors.description).toContain('500');
			expect(result.values.name).toBe('Synthetic playlist');
		}
	});

	it('accepts only the opaque URL-safe public-ID shape', () => {
		expect(isValidPlaylistPublicId('abcdefghijklmnopqrstuvwx')).toBe(true);
		expect(isValidPlaylistPublicId('../another-playlist')).toBe(false);
		expect(isValidPlaylistPublicId('short')).toBe(false);
	});
});

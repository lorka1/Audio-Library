import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	coverImageFileHasValidContents,
	deleteQuarantinedCoverImageFile,
	generateStoredCoverImageFilename,
	getValidatedCoverImageExtension,
	hasValidCoverImageSignature,
	quarantineStoredCoverImageFile,
	readStoredCoverImageFile,
	resolveCoverImageFilePath,
	restoreQuarantinedCoverImageFile,
	saveCoverImageFile
} from './cover-files';

const TEST_UUID = '550e8400-e29b-41d4-a716-446655440000';

function pngBytes(): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(24);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
	return bytes;
}

function jpegBytes(): Uint8Array<ArrayBuffer> {
	return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]);
}

function webpBytes(): Uint8Array<ArrayBuffer> {
	return new Uint8Array([
		0x52, 0x49, 0x46, 0x46,
		0x08, 0x00, 0x00, 0x00,
		0x57, 0x45, 0x42, 0x50,
		0x56, 0x50, 0x38, 0x58
	]);
}

async function exists(path: string): Promise<boolean> {
	return access(path).then(
		() => true,
		() => false
	);
}

describe('private cover image storage helpers', () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'audio-library-cover-files-'));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it.each([
		['cover.jpg', 'image/jpeg', '.jpg'],
		['cover.JPEG', 'image/jpeg', '.jpeg'],
		['cover.png', 'image/png', '.png'],
		['cover.webp', 'image/webp', '.webp']
	] as const)('accepts the matching raster format for %s', (name, mimeType, extension) => {
		expect(getValidatedCoverImageExtension(name, mimeType)).toBe(extension);
	});

	it.each([
		['cover.svg', 'image/svg+xml'],
		['cover.html', 'text/html'],
		['cover.png', 'image/jpeg'],
		['cover.jpg', 'application/octet-stream'],
		['cover.png.exe', 'image/png']
	])('rejects an unsupported or mismatched format: %s', (name, mimeType) => {
		expect(getValidatedCoverImageExtension(name, mimeType)).toBeNull();
	});

	it('recognizes JPEG, PNG, and WebP signatures and rejects renamed arbitrary bytes', async () => {
		expect(hasValidCoverImageSignature(jpegBytes(), '.jpg')).toBe(true);
		expect(hasValidCoverImageSignature(pngBytes(), '.png')).toBe(true);
		expect(hasValidCoverImageSignature(webpBytes(), '.webp')).toBe(true);
		expect(hasValidCoverImageSignature(new Uint8Array([1, 2, 3, 4]), '.png')).toBe(false);
		expect(
			await coverImageFileHasValidContents(
				new File([new Uint8Array([1, 2, 3, 4])], 'renamed.png', {
					type: 'image/png'
				}),
				'.png'
			)
		).toBe(false);
	});

	it('generates only UUID-based stored names and rejects path traversal', () => {
		expect(generateStoredCoverImageFilename('.PNG', TEST_UUID)).toBe(
			`${TEST_UUID}.png`
		);
		expect(() => resolveCoverImageFilePath(root, '../outside.png')).toThrow();
		expect(() =>
			resolveCoverImageFilePath(root, `${TEST_UUID}.png/../../outside`)
		).toThrow();
		expect(resolveCoverImageFilePath(root, `${TEST_UUID}.png`)).toBe(
			resolve(root, `${TEST_UUID}.png`)
		);
	});

	it('stores a valid cover exclusively without trusting its original filename', async () => {
		const stored = await saveCoverImageFile(
			new File([pngBytes()], '../../unsafe-name.png', { type: 'image/png' }),
			'.png',
			1024,
			root
		);

		expect(stored.storedFilename).toMatch(
			/^[0-9a-f-]{36}\.png$/
		);
		expect(stored.storedFilename).not.toContain('unsafe');
		expect(stored).toMatchObject({
			fileSizeBytes: pngBytes().byteLength,
			mimeType: 'image/png'
		});
		expect(new Uint8Array(await readFile(resolve(root, stored.storedFilename)))).toEqual(
			pngBytes()
		);
	});

	it('rejects invalid magic bytes and oversize data without leaving a file', async () => {
		await expect(
			saveCoverImageFile(
				new File([new Uint8Array([1, 2, 3, 4])], 'fake.png', {
					type: 'image/png'
				}),
				'.png',
				1024,
				root
			)
		).rejects.toThrow('content is invalid');
		await expect(
			saveCoverImageFile(
				new File([pngBytes()], 'cover.png', { type: 'image/png' }),
				'.png',
				4,
				root
			)
		).rejects.toThrow('file size is invalid');
		expect(await readdir(root)).toEqual([]);
	});

	it('reads only a bounded cover whose key, MIME, size, and bytes all agree', async () => {
		const stored = await saveCoverImageFile(
			new File([webpBytes()], 'cover.webp', { type: 'image/webp' }),
			'.webp',
			1024,
			root
		);
		const read = await readStoredCoverImageFile(
			stored.storedFilename,
			stored.mimeType,
			stored.fileSizeBytes,
			1024,
			root
		);
		expect(read).toMatchObject({
			success: true,
			file: {
				fileSizeBytes: webpBytes().byteLength,
				mimeType: 'image/webp'
			}
		});
		await expect(
			readStoredCoverImageFile(
				stored.storedFilename,
				'image/png',
				stored.fileSizeBytes,
				1024,
				root
			)
		).resolves.toEqual({ success: false, reason: 'invalid' });
		await expect(
			readStoredCoverImageFile(
				stored.storedFilename,
				stored.mimeType,
				stored.fileSizeBytes + 1,
				1024,
				root
			)
		).resolves.toEqual({ success: false, reason: 'invalid' });
	});

	it('quarantines, restores, and permanently removes only a validated cover key', async () => {
		const stored = await saveCoverImageFile(
			new File([jpegBytes()], 'cover.jpg', { type: 'image/jpeg' }),
			'.jpg',
			1024,
			root
		);
		const path = resolve(root, stored.storedFilename);
		const first = await quarantineStoredCoverImageFile(stored.storedFilename, root);
		expect(first.success && first.state).toBe('quarantined');
		if (!first.success || first.state !== 'quarantined') throw new Error('Expected quarantine.');
		expect(await exists(path)).toBe(false);
		await restoreQuarantinedCoverImageFile(first.file);
		expect(await exists(path)).toBe(true);

		const second = await quarantineStoredCoverImageFile(stored.storedFilename, root);
		if (!second.success || second.state !== 'quarantined') throw new Error('Expected quarantine.');
		await deleteQuarantinedCoverImageFile(second.file);
		expect(await exists(path)).toBe(false);
		await expect(
			quarantineStoredCoverImageFile(stored.storedFilename, root)
		).resolves.toEqual({ success: true, state: 'missing' });
	});
});

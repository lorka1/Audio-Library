import { describe, expect, it, vi } from 'vitest';
import { createPlaylist, deletePlaylist, updatePlaylist, type PlaylistManagementDependencies } from './management';

const ownerId = '11111111-1111-4111-8111-111111111111';
const publicId = 'abcdefghijklmnopqrstuvwx';
const oldImage = { storageKey: '11111111-1111-4111-8111-111111111111.png', mimeType: 'image/png', byteSize: 24 };
const stored = { storedFilename: '22222222-2222-4222-8222-222222222222.png', mimeType: 'image/png' as const, fileSizeBytes: 24 };

function png(valid = true): File {
	const bytes = new Uint8Array(24);
	bytes.set(valid ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] : [1, 2, 3, 4]);
	bytes.set([0x49, 0x48, 0x44, 0x52], 12);
	return new File([bytes], 'playlist.png', { type: 'image/png' });
}

function form(image?: File): FormData {
	const data = new FormData();
	data.set('name', 'Synthetic mix');
	data.set('description', 'Description');
	if (image) data.set('image', image);
	return data;
}

function dependencies(): PlaylistManagementDependencies {
	return {
		create: vi.fn().mockResolvedValue({}),
		update: vi.fn().mockResolvedValue({}),
		remove: vi.fn().mockResolvedValue(true),
		findStorage: vi.fn().mockResolvedValue({ publicId, image: oldImage }),
		saveImage: vi.fn().mockResolvedValue(stored),
		deleteImage: vi.fn().mockResolvedValue(undefined),
		quarantineImage: vi.fn().mockResolvedValue({ success: true, state: 'quarantined', file: { originalPath: 'old', quarantinePath: 'quarantine' } }),
		restoreImage: vi.fn().mockResolvedValue(undefined),
		deleteQuarantinedImage: vi.fn().mockResolvedValue(undefined)
	};
}

describe('playlist image lifecycle', () => {
	it('stores validated image metadata without exposing a path', async () => {
		const deps = dependencies();
		await expect(createPlaylist(ownerId, form(png()), 1024, deps)).resolves.toEqual({ success: true });
		expect(deps.create).toHaveBeenCalledWith(ownerId, expect.objectContaining({ image: { storageKey: stored.storedFilename, mimeType: 'image/png', byteSize: 24 } }));
		expect(JSON.stringify(vi.mocked(deps.create).mock.calls)).not.toContain('originalPath');
	});

	it('rejects a forged image signature before filesystem or database writes', async () => {
		const deps = dependencies();
		const result = await createPlaylist(ownerId, form(png(false)), 1024, deps);
		expect(result).toMatchObject({ success: false, status: 400, errors: { image: expect.stringContaining('content') } });
		expect(deps.saveImage).not.toHaveBeenCalled();
		expect(deps.create).not.toHaveBeenCalled();
	});

	it('removes a newly stored replacement and preserves the previous image when persistence fails', async () => {
		const deps = dependencies();
		vi.mocked(deps.update).mockRejectedValue(new Error('synthetic database failure'));
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const result = await updatePlaylist(ownerId, publicId, form(png()), 1024, deps);
		expect(result).toMatchObject({ success: false, status: 500 });
		expect(deps.deleteImage).toHaveBeenCalledWith(stored.storedFilename);
		expect(deps.quarantineImage).not.toHaveBeenCalled();
		log.mockRestore();
	});

	it('persists removal state and cleans only the previous image after success', async () => {
		const deps = dependencies();
		const data = form();
		data.set('removeImage', 'true');
		await expect(updatePlaylist(ownerId, publicId, data, 1024, deps)).resolves.toEqual({ success: true });
		expect(deps.update).toHaveBeenCalledWith(ownerId, publicId, expect.objectContaining({ image: null }));
		expect(deps.quarantineImage).toHaveBeenCalledWith(oldImage.storageKey);
		expect(deps.deleteQuarantinedImage).toHaveBeenCalled();
	});

	it('restores a quarantined image when playlist transaction deletion fails', async () => {
		const deps = dependencies();
		vi.mocked(deps.remove).mockRejectedValue(new Error('synthetic transaction failure'));
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const result = await deletePlaylist(ownerId, publicId, deps);
		expect(result).toMatchObject({ success: false, status: 500 });
		expect(deps.restoreImage).toHaveBeenCalled();
		expect(deps.deleteQuarantinedImage).not.toHaveBeenCalled();
		log.mockRestore();
	});

	it('deletes the owned quarantine only after the database transaction succeeds', async () => {
		const deps = dependencies();
		await expect(deletePlaylist(ownerId, publicId, deps)).resolves.toEqual({ success: true });
		expect(deps.remove).toHaveBeenCalledWith(ownerId, publicId);
		expect(deps.deleteQuarantinedImage).toHaveBeenCalled();
	});
});

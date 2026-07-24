import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	GENERIC_UPLOAD_ERROR,
	uploadTrack,
	type TrackUploadDependencies
} from './service';

const INTERNAL_TRACK_ID = '11111111-1111-4111-8111-111111111111';
const PUBLIC_TRACK_ID = 42;
const STORED_FILENAME = '22222222-2222-4222-8222-222222222222.mp3';
const NOW = new Date('2026-07-24T12:00:00.000Z');

function validUploadFormData(): FormData {
	const formData = new FormData();
	formData.set('title', '  Test Track  ');
	formData.set('artist', '  Test Artist  ');
	formData.set('bpm', '120');
	formData.set('musicalKey', 'C major');
	formData.set('genre', 'Electronic');
	formData.set('description', '  Test description.  ');
	formData.set('ownerId', 'forged-owner-id');
	formData.set('audioFile', new File([new Uint8Array([1, 2, 3])], 'original.mp3', {
		type: 'audio/mpeg'
	}));
	return formData;
}

function testDependencies(): TrackUploadDependencies {
	return {
		saveFile: vi.fn<TrackUploadDependencies['saveFile']>().mockResolvedValue({
			storedFilename: STORED_FILENAME,
			fileSizeBytes: 3
		}),
		deleteFile: vi.fn<TrackUploadDependencies['deleteFile']>().mockResolvedValue(undefined),
		insertTrack: vi.fn<TrackUploadDependencies['insertTrack']>().mockResolvedValue({
			id: PUBLIC_TRACK_ID,
			title: 'Test Track',
			createdAt: NOW
		}),
		generateId: vi
			.fn<TrackUploadDependencies['generateId']>()
			.mockReturnValue(INTERNAL_TRACK_ID),
		now: vi.fn<TrackUploadDependencies['now']>().mockReturnValue(NOW)
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('uploadTrack', () => {
	it('stores the file before inserting normalized metadata for the authenticated owner', async () => {
		const callOrder: string[] = [];
		const dependencies = testDependencies();
		const originalSaveFile = dependencies.saveFile;
		const originalInsertTrack = dependencies.insertTrack;

		dependencies.saveFile = vi.fn(async (file, extension) => {
			callOrder.push('file');
			return originalSaveFile(file, extension);
		});
		dependencies.insertTrack = vi.fn(async (input) => {
			callOrder.push('database');
			return originalInsertTrack(input);
		});

		const result = await uploadTrack(
			{
				ownerId: 'authenticated-owner',
				formData: validUploadFormData(),
				maxFileSizeBytes: 1024
			},
			dependencies
		);

		expect(result).toEqual({
			success: true,
			track: {
				id: PUBLIC_TRACK_ID,
				title: 'Test Track',
				createdAt: NOW
			}
		});
		expect(callOrder).toEqual(['file', 'database']);
		expect(dependencies.saveFile).toHaveBeenCalledWith(expect.any(File), '.mp3');
		expect(dependencies.insertTrack).toHaveBeenCalledWith({
			id: INTERNAL_TRACK_ID,
			ownerId: 'authenticated-owner',
			title: 'Test Track',
			artist: 'Test Artist',
			bpm: 120,
			musicalKey: 'C major',
			genre: 'Electronic',
			description: 'Test description.',
			originalFilename: 'original.mp3',
			storageKey: STORED_FILENAME,
			mimeType: 'audio/mpeg',
			fileSizeBytes: 3,
			createdAt: NOW,
			updatedAt: NOW
		});
		expect(dependencies.deleteFile).not.toHaveBeenCalled();
	});

	it('performs no filesystem or database work when validation fails', async () => {
		const dependencies = testDependencies();
		const formData = validUploadFormData();
		formData.set('title', '   ');

		const result = await uploadTrack(
			{
				ownerId: 'authenticated-owner',
				formData,
				maxFileSizeBytes: 1024
			},
			dependencies
		);

		expect(result).toMatchObject({
			success: false,
			status: 400,
			errors: { title: 'Title is required.' },
			needsAudioFileReselection: true
		});
		expect(dependencies.saveFile).not.toHaveBeenCalled();
		expect(dependencies.insertTrack).not.toHaveBeenCalled();
		expect(dependencies.deleteFile).not.toHaveBeenCalled();

		if (!result.success) {
			expect(result.values).not.toHaveProperty('audioFile');
		}
	});

	it('does not insert metadata when writing the file fails', async () => {
		const dependencies = testDependencies();
		dependencies.saveFile = vi
			.fn<TrackUploadDependencies['saveFile']>()
			.mockRejectedValue(new Error('C:\\private\\audio\\must-not-leak.mp3'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const result = await uploadTrack(
			{
				ownerId: 'authenticated-owner',
				formData: validUploadFormData(),
				maxFileSizeBytes: 1024
			},
			dependencies
		);

		expect(result).toMatchObject({
			success: false,
			status: 500,
			errors: { general: GENERIC_UPLOAD_ERROR }
		});
		expect(dependencies.insertTrack).not.toHaveBeenCalled();
		expect(dependencies.deleteFile).not.toHaveBeenCalled();
		expect(JSON.stringify(consoleError.mock.calls)).not.toContain('must-not-leak');
	});

	it('removes the stored file when the database insert fails', async () => {
		const dependencies = testDependencies();
		dependencies.insertTrack = vi
			.fn<TrackUploadDependencies['insertTrack']>()
			.mockRejectedValue(new Error('synthetic database failure'));
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const result = await uploadTrack(
			{
				ownerId: 'authenticated-owner',
				formData: validUploadFormData(),
				maxFileSizeBytes: 1024
			},
			dependencies
		);

		expect(result).toMatchObject({
			success: false,
			status: 500,
			errors: { general: GENERIC_UPLOAD_ERROR }
		});
		expect(dependencies.deleteFile).toHaveBeenCalledOnce();
		expect(dependencies.deleteFile).toHaveBeenCalledWith(STORED_FILENAME);
	});

	it('keeps the generic response if rollback also fails', async () => {
		const dependencies = testDependencies();
		dependencies.insertTrack = vi
			.fn<TrackUploadDependencies['insertTrack']>()
			.mockRejectedValue(new Error('synthetic database failure'));
		dependencies.deleteFile = vi
			.fn<TrackUploadDependencies['deleteFile']>()
			.mockRejectedValue(new Error('synthetic rollback failure'));
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const result = await uploadTrack(
			{
				ownerId: 'authenticated-owner',
				formData: validUploadFormData(),
				maxFileSizeBytes: 1024
			},
			dependencies
		);

		expect(result).toMatchObject({
			success: false,
			status: 500,
			errors: { general: GENERIC_UPLOAD_ERROR }
		});
		expect(JSON.stringify(result)).not.toContain('rollback failure');
	});
});

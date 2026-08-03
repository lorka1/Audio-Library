import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OwnerTrack } from '$lib/types';
import {
	GENERIC_METADATA_UPDATE_ERROR,
	GENERIC_TRACK_DELETE_ERROR,
	deleteTrack,
	updateTrackMetadata,
	type TrackManagementDependencies
} from './management';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const PUBLIC_ID = 42;
const STORED_FILENAME = '33333333-3333-4333-8333-333333333333.mp3';
const STORED_COVER_FILENAME = '44444444-4444-4444-8444-444444444444.png';
const NOW = new Date('2026-07-26T12:00:00.000Z');
const QUARANTINED_FILE = {
	originalPath: 'C:\\private\\audio\\original.mp3',
	quarantinePath: 'C:\\private\\audio\\.delete-private.tmp'
};
const QUARANTINED_COVER_FILE = {
	originalPath: 'C:\\private\\audio\\covers\\original.png',
	quarantinePath: 'C:\\private\\audio\\covers\\.delete-private.tmp'
};

function pngBytes(): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(24);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
	return bytes;
}

function ownerTrack(): OwnerTrack {
	return {
		publicId: PUBLIC_ID,
		title: 'Updated title',
		artist: 'Updated artist',
		coverImageUrl: null,
		bpm: 128,
		musicalKey: 'D minor',
		genre: 'Techno',
		description: 'Updated description.',
		visibility: 'public',
		fileSizeBytes: 3,
		mimeType: 'audio/mpeg',
		originalFilename: 'original.mp3',
		createdAt: '2026-07-24T12:00:00.000Z',
		updatedAt: NOW.toISOString()
	};
}

function metadataFormData(): FormData {
	const formData = new FormData();
	formData.set('title', '  Updated title  ');
	formData.set('artist', '  Forged artist  ');
	formData.set('bpm', '128');
	formData.set('musicalKey', 'D minor');
	formData.set('genre', 'Techno');
	formData.set('description', '  Updated description.  ');
	formData.set('ownerId', OTHER_ID);
	formData.set('visibility', 'private');
	formData.set('storageKey', '../forged.mp3');
	return formData;
}

function dependencies(): TrackManagementDependencies {
	return {
		updateMetadata: vi
			.fn<TrackManagementDependencies['updateMetadata']>()
			.mockResolvedValue(ownerTrack()),
		findFile: vi.fn<TrackManagementDependencies['findFile']>().mockResolvedValue({
			publicId: PUBLIC_ID,
			storedFilename: STORED_FILENAME,
			coverImage: null
		}),
		saveCoverFile: vi
			.fn<TrackManagementDependencies['saveCoverFile']>()
			.mockResolvedValue({
				storedFilename: STORED_COVER_FILENAME,
				fileSizeBytes: 24,
				mimeType: 'image/png'
			}),
		deleteCoverFile: vi
			.fn<TrackManagementDependencies['deleteCoverFile']>()
			.mockResolvedValue(undefined),
		deleteRecord: vi
			.fn<TrackManagementDependencies['deleteRecord']>()
			.mockResolvedValue(true),
		quarantineFile: vi
			.fn<TrackManagementDependencies['quarantineFile']>()
			.mockResolvedValue({
				success: true,
				state: 'quarantined',
				file: QUARANTINED_FILE
			}),
		quarantineCoverFile: vi
			.fn<TrackManagementDependencies['quarantineCoverFile']>()
			.mockResolvedValue({ success: true, state: 'missing' }),
		deleteQuarantinedFile: vi
			.fn<TrackManagementDependencies['deleteQuarantinedFile']>()
			.mockResolvedValue(undefined),
		deleteQuarantinedCoverFile: vi
			.fn<TrackManagementDependencies['deleteQuarantinedCoverFile']>()
			.mockResolvedValue(undefined),
		restoreQuarantinedFile: vi
			.fn<TrackManagementDependencies['restoreQuarantinedFile']>()
			.mockResolvedValue(undefined),
		restoreQuarantinedCoverFile: vi
			.fn<TrackManagementDependencies['restoreQuarantinedCoverFile']>()
			.mockResolvedValue(undefined),
		now: vi.fn<TrackManagementDependencies['now']>().mockReturnValue(NOW)
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('updateTrackMetadata', () => {
	it('updates normalized metadata using only the authenticated owner ID', async () => {
		const testDependencies = dependencies();

		const result = await updateTrackMetadata(
			{
				publicId: PUBLIC_ID,
				ownerId: OWNER_ID,
				formData: metadataFormData()
			},
			testDependencies
		);

		expect(result).toEqual({ success: true });
		expect(testDependencies.updateMetadata).toHaveBeenCalledWith(
			PUBLIC_ID,
			OWNER_ID,
			{
				title: 'Updated title',
				bpm: 128,
				musicalKey: 'D minor',
				genre: 'Techno',
				description: 'Updated description.',
				updatedAt: NOW
			}
		);
		const updateCalls = vi.mocked(testDependencies.updateMetadata).mock.calls;
		expect(updateCalls[0]?.[2]).not.toHaveProperty('artist');
		expect(JSON.stringify(updateCalls)).not.toContain(OTHER_ID);
		expect(JSON.stringify(updateCalls)).not.toContain(
			'../forged.mp3'
		);
	});

	it('preserves submitted safe values and performs no update on validation failure', async () => {
		const testDependencies = dependencies();
		const formData = metadataFormData();
		formData.set('title', '   ');
		formData.set('artist', 'Forged attribution');
		formData.set('bpm', '+120');
		formData.set('musicalKey', 'H major');
		formData.set('genre', 'Forged');
		formData.set('description', 'D'.repeat(2001));

		const result = await updateTrackMetadata(
			{ publicId: PUBLIC_ID, ownerId: OWNER_ID, formData },
			testDependencies
		);

		expect(result).toMatchObject({
			success: false,
			status: 400,
			values: {
				title: '',
				bpm: '+120',
				musicalKey: 'H major',
				genre: 'Forged'
			},
			errors: {
				title: 'Title is required.',
				bpm: 'BPM must be an integer.',
				musicalKey: 'Select a valid musical key.',
				genre: 'Select a valid genre.',
				description: 'Description must be at most 2000 characters.'
			}
		});
		expect(testDependencies.updateMetadata).not.toHaveBeenCalled();
	});

	it('returns the same safe not-found result when the owner condition changes zero rows', async () => {
		const testDependencies = dependencies();
		testDependencies.updateMetadata = vi
			.fn<TrackManagementDependencies['updateMetadata']>()
			.mockResolvedValue(null);

		const result = await updateTrackMetadata(
			{ publicId: PUBLIC_ID, ownerId: OTHER_ID, formData: metadataFormData() },
			testDependencies
		);

		expect(result).toMatchObject({ success: false, status: 404, errors: {} });
		expect(testDependencies.updateMetadata).toHaveBeenCalledWith(
			PUBLIC_ID,
			OTHER_ID,
			expect.any(Object)
		);
	});

	it('sanitizes unexpected database failures', async () => {
		const testDependencies = dependencies();
		testDependencies.updateMetadata = vi
			.fn<TrackManagementDependencies['updateMetadata']>()
			.mockRejectedValue(new Error('C:\\private\\database\\secret.db'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const result = await updateTrackMetadata(
			{ publicId: PUBLIC_ID, ownerId: OWNER_ID, formData: metadataFormData() },
			testDependencies
		);

		expect(result).toMatchObject({
			success: false,
			status: 500,
			errors: { general: GENERIC_METADATA_UPDATE_ERROR }
		});
		expect(JSON.stringify(result)).not.toContain('C:\\private');
		expect(JSON.stringify(consoleError.mock.calls)).not.toContain('C:\\private');
	});

	it('replaces a cover for the owner and cleans the previous file only after persistence', async () => {
		const testDependencies = dependencies();
		testDependencies.findFile = vi
			.fn<TrackManagementDependencies['findFile']>()
			.mockResolvedValue({
				publicId: PUBLIC_ID,
				storedFilename: STORED_FILENAME,
				coverImage: {
					storageKey: '55555555-5555-4555-8555-555555555555.jpg',
					mimeType: 'image/jpeg',
					byteSize: 8
				}
			});
		testDependencies.quarantineCoverFile = vi
			.fn<TrackManagementDependencies['quarantineCoverFile']>()
			.mockResolvedValue({
				success: true,
				state: 'quarantined',
				file: QUARANTINED_COVER_FILE
			});
		const formData = metadataFormData();
		formData.set(
			'coverImage',
			new File([pngBytes()], 'replacement.png', { type: 'image/png' })
		);

		const result = await updateTrackMetadata(
			{
				publicId: PUBLIC_ID,
				ownerId: OWNER_ID,
				formData,
				maxCoverImageSizeBytes: 1024
			},
			testDependencies
		);

		expect(result).toEqual({ success: true });
		expect(testDependencies.updateMetadata).toHaveBeenCalledWith(
			PUBLIC_ID,
			OWNER_ID,
			expect.objectContaining({
				coverImage: {
					storageKey: STORED_COVER_FILENAME,
					mimeType: 'image/png',
					byteSize: 24
				}
			})
		);
		expect(testDependencies.quarantineCoverFile).toHaveBeenCalledWith(
			'55555555-5555-4555-8555-555555555555.jpg'
		);
		expect(testDependencies.deleteQuarantinedCoverFile).toHaveBeenCalledWith(
			QUARANTINED_COVER_FILE
		);
	});

	it('deletes a new replacement and leaves the previous cover untouched on database failure', async () => {
		const testDependencies = dependencies();
		testDependencies.findFile = vi
			.fn<TrackManagementDependencies['findFile']>()
			.mockResolvedValue({
				publicId: PUBLIC_ID,
				storedFilename: STORED_FILENAME,
				coverImage: {
					storageKey: '55555555-5555-4555-8555-555555555555.jpg',
					mimeType: 'image/jpeg',
					byteSize: 8
				}
			});
		testDependencies.updateMetadata = vi
			.fn<TrackManagementDependencies['updateMetadata']>()
			.mockRejectedValue(new Error('synthetic database failure'));
		const formData = metadataFormData();
		formData.set(
			'coverImage',
			new File([pngBytes()], 'replacement.png', { type: 'image/png' })
		);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const result = await updateTrackMetadata(
			{
				publicId: PUBLIC_ID,
				ownerId: OWNER_ID,
				formData,
				maxCoverImageSizeBytes: 1024
			},
			testDependencies
		);

		expect(result).toMatchObject({ success: false, status: 500 });
		expect(testDependencies.deleteCoverFile).toHaveBeenCalledWith(
			STORED_COVER_FILENAME
		);
		expect(testDependencies.quarantineCoverFile).not.toHaveBeenCalled();
	});

	it('removes an owner cover while retaining audio and authenticated ownership', async () => {
		const testDependencies = dependencies();
		testDependencies.findFile = vi
			.fn<TrackManagementDependencies['findFile']>()
			.mockResolvedValue({
				publicId: PUBLIC_ID,
				storedFilename: STORED_FILENAME,
				coverImage: {
					storageKey: STORED_COVER_FILENAME,
					mimeType: 'image/png',
					byteSize: 24
				}
			});
		testDependencies.quarantineCoverFile = vi
			.fn<TrackManagementDependencies['quarantineCoverFile']>()
			.mockResolvedValue({
				success: true,
				state: 'quarantined',
				file: QUARANTINED_COVER_FILE
			});
		const formData = metadataFormData();
		formData.set('removeCoverImage', '1');

		const result = await updateTrackMetadata(
			{ publicId: PUBLIC_ID, ownerId: OWNER_ID, formData },
			testDependencies
		);

		expect(result).toEqual({ success: true });
		expect(testDependencies.updateMetadata).toHaveBeenCalledWith(
			PUBLIC_ID,
			OWNER_ID,
			expect.objectContaining({ coverImage: null })
		);
		expect(testDependencies.quarantineFile).not.toHaveBeenCalled();
		expect(testDependencies.quarantineCoverFile).toHaveBeenCalledWith(
			STORED_COVER_FILENAME
		);
	});

	it('does not write a replacement cover when the owner-scoped lookup fails', async () => {
		const testDependencies = dependencies();
		testDependencies.findFile = vi
			.fn<TrackManagementDependencies['findFile']>()
			.mockResolvedValue(null);
		const formData = metadataFormData();
		formData.set(
			'coverImage',
			new File([pngBytes()], 'replacement.png', { type: 'image/png' })
		);

		const result = await updateTrackMetadata(
			{ publicId: PUBLIC_ID, ownerId: OTHER_ID, formData },
			testDependencies
		);

		expect(result).toMatchObject({ success: false, status: 404 });
		expect(testDependencies.saveCoverFile).not.toHaveBeenCalled();
		expect(testDependencies.updateMetadata).not.toHaveBeenCalled();
	});
});

describe('deleteTrack', () => {
	it('quarantines the exact owner file, deletes the owner row, then removes quarantine', async () => {
		const testDependencies = dependencies();
		const order: string[] = [];
		testDependencies.quarantineFile = vi.fn(async () => {
			order.push('quarantine');
			return {
				success: true as const,
				state: 'quarantined' as const,
				file: QUARANTINED_FILE
			};
		});
		testDependencies.deleteRecord = vi.fn(async () => {
			order.push('database');
			return true;
		});
		testDependencies.deleteQuarantinedFile = vi.fn(async () => {
			order.push('unlink');
		});

		const result = await deleteTrack(
			{ publicId: PUBLIC_ID, ownerId: OWNER_ID },
			testDependencies
		);

		expect(result).toEqual({ success: true });
		expect(order).toEqual(['quarantine', 'database', 'unlink']);
		expect(testDependencies.findFile).toHaveBeenCalledWith(PUBLIC_ID, OWNER_ID);
		expect(testDependencies.quarantineFile).toHaveBeenCalledWith(STORED_FILENAME);
		expect(testDependencies.deleteRecord).toHaveBeenCalledWith(PUBLIC_ID, OWNER_ID);
		expect(testDependencies.restoreQuarantinedFile).not.toHaveBeenCalled();
	});

	it('treats an already missing physical file as cleaned and deletes the owned row', async () => {
		const testDependencies = dependencies();
		testDependencies.quarantineFile = vi
			.fn<TrackManagementDependencies['quarantineFile']>()
			.mockResolvedValue({ success: true, state: 'missing' });

		const result = await deleteTrack(
			{ publicId: PUBLIC_ID, ownerId: OWNER_ID },
			testDependencies
		);

		expect(result).toEqual({ success: true });
		expect(testDependencies.deleteRecord).toHaveBeenCalledWith(PUBLIC_ID, OWNER_ID);
		expect(testDependencies.deleteQuarantinedFile).not.toHaveBeenCalled();
		expect(testDependencies.restoreQuarantinedFile).not.toHaveBeenCalled();
	});

	it.each(['unsafe', 'not-file', 'unavailable'] as const)(
		'fails closed for a %s physical file without deleting the row',
		async (reason) => {
			const testDependencies = dependencies();
			testDependencies.quarantineFile = vi
				.fn<TrackManagementDependencies['quarantineFile']>()
				.mockResolvedValue({ success: false, reason });

			const result = await deleteTrack(
				{ publicId: PUBLIC_ID, ownerId: OWNER_ID },
				testDependencies
			);

			expect(result).toEqual({
				success: false,
				status: 500,
				message: GENERIC_TRACK_DELETE_ERROR
			});
			expect(testDependencies.deleteRecord).not.toHaveBeenCalled();
		}
	);

	it('restores the quarantined file when database deletion fails', async () => {
		const testDependencies = dependencies();
		testDependencies.deleteRecord = vi
			.fn<TrackManagementDependencies['deleteRecord']>()
			.mockRejectedValue(new Error('synthetic database failure'));
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const result = await deleteTrack(
			{ publicId: PUBLIC_ID, ownerId: OWNER_ID },
			testDependencies
		);

		expect(result).toMatchObject({ success: false, status: 500 });
		expect(testDependencies.restoreQuarantinedFile).toHaveBeenCalledWith(
			QUARANTINED_FILE
		);
		expect(testDependencies.deleteQuarantinedFile).not.toHaveBeenCalled();
	});

	it('reports final unlink failure and attempts to restore the original safe filename', async () => {
		const testDependencies = dependencies();
		testDependencies.deleteQuarantinedFile = vi
			.fn<TrackManagementDependencies['deleteQuarantinedFile']>()
			.mockRejectedValue(new Error('C:\\private\\audio\\.delete-private.tmp'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const result = await deleteTrack(
			{ publicId: PUBLIC_ID, ownerId: OWNER_ID },
			testDependencies
		);

		expect(result).toEqual({
			success: false,
			status: 500,
			message: GENERIC_TRACK_DELETE_ERROR
		});
		expect(testDependencies.restoreQuarantinedFile).toHaveBeenCalledWith(
			QUARANTINED_FILE
		);
		expect(JSON.stringify(result)).not.toContain('C:\\private');
		expect(JSON.stringify(consoleError.mock.calls)).not.toContain('C:\\private');
	});

	it('does not touch a file or row when the owner-scoped lookup finds nothing', async () => {
		const testDependencies = dependencies();
		testDependencies.findFile = vi
			.fn<TrackManagementDependencies['findFile']>()
			.mockResolvedValue(null);

		const result = await deleteTrack(
			{ publicId: PUBLIC_ID, ownerId: OTHER_ID },
			testDependencies
		);

		expect(result).toEqual({
			success: false,
			status: 404,
			message: 'Track not found.'
		});
		expect(testDependencies.quarantineFile).not.toHaveBeenCalled();
		expect(testDependencies.deleteRecord).not.toHaveBeenCalled();
		expect(testDependencies.deleteQuarantinedFile).not.toHaveBeenCalled();
	});

	it('cleans quarantine safely when a concurrent request already deleted the row', async () => {
		const testDependencies = dependencies();
		testDependencies.deleteRecord = vi
			.fn<TrackManagementDependencies['deleteRecord']>()
			.mockResolvedValue(false);

		const result = await deleteTrack(
			{ publicId: PUBLIC_ID, ownerId: OWNER_ID },
			testDependencies
		);

		expect(result).toMatchObject({ success: false, status: 404 });
		expect(testDependencies.deleteQuarantinedFile).toHaveBeenCalledWith(
			QUARANTINED_FILE
		);
		expect(testDependencies.restoreQuarantinedFile).not.toHaveBeenCalled();
	});

	it('quarantines and removes both audio and cover for an owner deletion', async () => {
		const testDependencies = dependencies();
		testDependencies.findFile = vi
			.fn<TrackManagementDependencies['findFile']>()
			.mockResolvedValue({
				publicId: PUBLIC_ID,
				storedFilename: STORED_FILENAME,
				coverImage: {
					storageKey: STORED_COVER_FILENAME,
					mimeType: 'image/png',
					byteSize: 24
				}
			});
		testDependencies.quarantineCoverFile = vi
			.fn<TrackManagementDependencies['quarantineCoverFile']>()
			.mockResolvedValue({
				success: true,
				state: 'quarantined',
				file: QUARANTINED_COVER_FILE
			});

		const result = await deleteTrack(
			{ publicId: PUBLIC_ID, ownerId: OWNER_ID },
			testDependencies
		);

		expect(result).toEqual({ success: true });
		expect(testDependencies.quarantineFile).toHaveBeenCalledWith(STORED_FILENAME);
		expect(testDependencies.quarantineCoverFile).toHaveBeenCalledWith(
			STORED_COVER_FILENAME
		);
		expect(testDependencies.deleteQuarantinedFile).toHaveBeenCalledWith(
			QUARANTINED_FILE
		);
		expect(testDependencies.deleteQuarantinedCoverFile).toHaveBeenCalledWith(
			QUARANTINED_COVER_FILE
		);
	});

	it('restores both quarantined files when owner database deletion fails', async () => {
		const testDependencies = dependencies();
		testDependencies.findFile = vi
			.fn<TrackManagementDependencies['findFile']>()
			.mockResolvedValue({
				publicId: PUBLIC_ID,
				storedFilename: STORED_FILENAME,
				coverImage: {
					storageKey: STORED_COVER_FILENAME,
					mimeType: 'image/png',
					byteSize: 24
				}
			});
		testDependencies.quarantineCoverFile = vi
			.fn<TrackManagementDependencies['quarantineCoverFile']>()
			.mockResolvedValue({
				success: true,
				state: 'quarantined',
				file: QUARANTINED_COVER_FILE
			});
		testDependencies.deleteRecord = vi
			.fn<TrackManagementDependencies['deleteRecord']>()
			.mockRejectedValue(new Error('synthetic database failure'));
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const result = await deleteTrack(
			{ publicId: PUBLIC_ID, ownerId: OWNER_ID },
			testDependencies
		);

		expect(result).toMatchObject({ success: false, status: 500 });
		expect(testDependencies.restoreQuarantinedFile).toHaveBeenCalledWith(
			QUARANTINED_FILE
		);
		expect(testDependencies.restoreQuarantinedCoverFile).toHaveBeenCalledWith(
			QUARANTINED_COVER_FILE
		);
	});
});

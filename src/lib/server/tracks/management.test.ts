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
const NOW = new Date('2026-07-26T12:00:00.000Z');
const QUARANTINED_FILE = {
	originalPath: 'C:\\private\\audio\\original.mp3',
	quarantinePath: 'C:\\private\\audio\\.delete-private.tmp'
};

function ownerTrack(): OwnerTrack {
	return {
		publicId: PUBLIC_ID,
		title: 'Updated title',
		artist: 'Updated artist',
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
	formData.set('artist', '  Updated artist  ');
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
			storedFilename: STORED_FILENAME
		}),
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
		deleteQuarantinedFile: vi
			.fn<TrackManagementDependencies['deleteQuarantinedFile']>()
			.mockResolvedValue(undefined),
		restoreQuarantinedFile: vi
			.fn<TrackManagementDependencies['restoreQuarantinedFile']>()
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
				artist: 'Updated artist',
				bpm: 128,
				musicalKey: 'D minor',
				genre: 'Techno',
				description: 'Updated description.',
				updatedAt: NOW
			}
		);
		const updateCalls = vi.mocked(testDependencies.updateMetadata).mock.calls;
		expect(JSON.stringify(updateCalls)).not.toContain(OTHER_ID);
		expect(JSON.stringify(updateCalls)).not.toContain(
			'../forged.mp3'
		);
	});

	it('preserves submitted safe values and performs no update on validation failure', async () => {
		const testDependencies = dependencies();
		const formData = metadataFormData();
		formData.set('title', '   ');
		formData.set('artist', 'A'.repeat(121));
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
				artist: 'Artist must be at most 120 characters.',
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
});

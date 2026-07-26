import { describe, expect, it } from 'vitest';
import {
	TRACK_PUBLIC_ID_COUNTER,
	type CounterDocument,
	type SessionDocument,
	type TrackDocument,
	type UserDocument
} from './documents';

describe('MongoDB document models', () => {
	it('retain the exact current user and session semantics with Date values', () => {
		const now = new Date('2026-07-26T12:00:00.000Z');
		const user = {
			_id: '11111111-1111-4111-8111-111111111111',
			username: 'fixture_owner',
			email: 'fixture@example.test',
			passwordHash: 'synthetic-password-hash',
			createdAt: now,
			updatedAt: now
		} satisfies UserDocument;
		const session = {
			_id: '22222222-2222-4222-8222-222222222222',
			tokenHash: 'synthetic-token-hash',
			userId: user._id,
			expiresAt: new Date('2026-07-27T12:00:00.000Z'),
			createdAt: now
		} satisfies SessionDocument;

		expect(Object.keys(user)).toEqual([
			'_id',
			'username',
			'email',
			'passwordHash',
			'createdAt',
			'updatedAt'
		]);
		expect(session.expiresAt).toBeInstanceOf(Date);
	});

	it('retains track metadata and storage references without embedding audio', () => {
		const now = new Date('2026-07-26T12:00:00.000Z');
		const track = {
			_id: '33333333-3333-4333-8333-333333333333',
			publicId: 42,
			ownerId: '11111111-1111-4111-8111-111111111111',
			title: 'Synthetic Track',
			artist: 'Fixture Artist',
			bpm: null,
			musicalKey: null,
			genre: null,
			description: null,
			originalFilename: 'fixture.mp3',
			storageKey: '44444444-4444-4444-8444-444444444444.mp3',
			mimeType: 'audio/mpeg',
			fileSizeBytes: 128,
			durationMs: null,
			visibility: 'public',
			createdAt: now,
			updatedAt: now
		} satisfies TrackDocument;

		expect(track).not.toHaveProperty('audio');
		expect(track).not.toHaveProperty('bytes');
		expect(track.publicId).toBe(42);
	});

	it('defines one counter for atomic public numeric track IDs', () => {
		const counter = {
			_id: TRACK_PUBLIC_ID_COUNTER,
			value: 42
		} satisfies CounterDocument;

		expect(counter).toEqual({ _id: 'tracks.publicId', value: 42 });
	});
});

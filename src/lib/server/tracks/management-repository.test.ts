import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '$lib/server/db/schema';

vi.mock('$lib/server/db', () => ({ db: {} }));

import {
	deleteOwnedTrackRecord,
	findOwnedTrackByPublicId,
	findOwnedTrackFileByPublicId,
	listTracksByOwner,
	updateOwnedTrackMetadata
} from './repository';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

function openTestDatabase(client: Client) {
	return drizzle({ client, schema });
}

type TestDatabase = ReturnType<typeof openTestDatabase>;

let client: Client;
let database: TestDatabase;

async function seedDatabase(): Promise<void> {
	await client.execute(`
		create table users (
			id text primary key not null,
			email text not null,
			username text not null,
			password_hash text not null,
			created_at integer not null,
			updated_at integer not null
		)
	`);
	await client.execute(`
		create table tracks (
			public_id integer primary key autoincrement not null,
			id text not null unique,
			owner_id text not null,
			title text not null,
			artist text not null,
			bpm integer,
			musical_key text,
			genre text,
			description text,
			original_filename text not null,
			storage_key text not null unique,
			mime_type text not null,
			file_size_bytes integer not null,
			duration_ms integer,
			visibility text not null,
			created_at integer not null,
			updated_at integer not null
		)
	`);

	for (const [id, email, username] of [
		[OWNER_ID, 'owner@example.test', 'owner'],
		[OTHER_ID, 'other@example.test', 'other']
	]) {
		await client.execute({
			sql: 'insert into users (id, email, username, password_hash, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
			args: [id, email, username, 'hash', 100, 100]
		});
	}

	const definitions = [
		{
			internalId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
			ownerId: OWNER_ID,
			title: 'Owner oldest public',
			visibility: 'public',
			createdAt: 100
		},
		{
			internalId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
			ownerId: OWNER_ID,
			title: 'Owner middle public',
			visibility: 'public',
			createdAt: 200
		},
		{
			internalId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
			ownerId: OWNER_ID,
			title: 'Owner newest private',
			visibility: 'private',
			createdAt: 300
		},
		{
			internalId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
			ownerId: OTHER_ID,
			title: 'Other user track',
			visibility: 'public',
			createdAt: 400
		}
	] as const;

	for (const [index, definition] of definitions.entries()) {
		await client.execute({
			sql: `insert into tracks (
				id, owner_id, title, artist, bpm, musical_key, genre, description,
				original_filename, storage_key, mime_type, file_size_bytes,
				duration_ms, visibility, created_at, updated_at
			) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				definition.internalId,
				definition.ownerId,
				definition.title,
				`Artist ${index}`,
				120 + index,
				'C minor',
				'Techno',
				`Description ${index}`,
				`original-${index}.mp3`,
				`00000000-0000-4000-8000-${String(index).padStart(12, '0')}.mp3`,
				'audio/mpeg',
				100 + index,
				null,
				definition.visibility,
				definition.createdAt,
				definition.createdAt
			]
		});
	}
}

beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	database = openTestDatabase(client);
	await seedDatabase();
});

afterEach(() => {
	client.close();
});

describe('owner track repository', () => {
	it('lists only the owner tracks, including public and private, newest first', async () => {
		const records = await listTracksByOwner(OWNER_ID, database);

		expect(records.map((track) => track.title)).toEqual([
			'Owner newest private',
			'Owner middle public',
			'Owner oldest public'
		]);
		expect(records.map((track) => track.visibility)).toEqual([
			'private',
			'public',
			'public'
		]);
		expect(JSON.stringify(records)).not.toContain('Other user track');
	});

	it('returns only the explicit owner-safe projection', async () => {
		const [record] = await listTracksByOwner(OWNER_ID, database);

		expect(Object.keys(record).sort()).toEqual([
			'artist',
			'bpm',
			'createdAt',
			'description',
			'fileSizeBytes',
			'genre',
			'mimeType',
			'musicalKey',
			'originalFilename',
			'publicId',
			'title',
			'updatedAt',
			'visibility'
		]);
		expect(JSON.stringify(record)).not.toContain(OWNER_ID);
		expect(JSON.stringify(record)).not.toContain('aaaaaaaa-aaaa');
		expect(JSON.stringify(record)).not.toContain('storageKey');
		expect(JSON.stringify(record)).not.toContain('storedFilename');
	});

	it('loads editable metadata only for the matching owner and public ID', async () => {
		const ownerTracks = await listTracksByOwner(OWNER_ID, database);
		const publicId = ownerTracks[0].publicId;

		await expect(
			findOwnedTrackByPublicId(publicId, OWNER_ID, database)
		).resolves.toMatchObject({ publicId, title: 'Owner newest private' });
		await expect(
			findOwnedTrackByPublicId(publicId, OTHER_ID, database)
		).resolves.toBeNull();
	});

	it('updates metadata with an owner condition and preserves every immutable field', async () => {
		const ownerTracks = await listTracksByOwner(OWNER_ID, database);
		const publicId = ownerTracks.find((track) => track.title === 'Owner middle public')!.publicId;
		const before = await client.execute({
			sql: 'select * from tracks where public_id = ?',
			args: [publicId]
		});

		const updated = await updateOwnedTrackMetadata(
			publicId,
			OWNER_ID,
			{
				title: 'Updated title',
				artist: 'Updated artist',
				bpm: 140,
				musicalKey: 'D minor',
				genre: 'Jazz',
				description: 'Updated description.',
				updatedAt: new Date(999_000)
			},
			database
		);
		const after = await client.execute({
			sql: 'select * from tracks where public_id = ?',
			args: [publicId]
		});

		expect(updated).toMatchObject({
			publicId,
			title: 'Updated title',
			artist: 'Updated artist',
			bpm: 140,
			musicalKey: 'D minor',
			genre: 'Jazz',
			description: 'Updated description.'
		});

		for (const immutableColumn of [
			'public_id',
			'id',
			'owner_id',
			'visibility',
			'original_filename',
			'storage_key',
			'mime_type',
			'file_size_bytes',
			'duration_ms',
			'created_at'
		]) {
			expect(after.rows[0][immutableColumn]).toBe(before.rows[0][immutableColumn]);
		}
	});

	it('changes zero rows for a non-owner update', async () => {
		const [track] = await listTracksByOwner(OWNER_ID, database);
		const before = await client.execute({
			sql: 'select * from tracks where public_id = ?',
			args: [track.publicId]
		});

		const result = await updateOwnedTrackMetadata(
			track.publicId,
			OTHER_ID,
			{
				title: 'Forged',
				artist: 'Forged',
				bpm: null,
				musicalKey: null,
				genre: null,
				description: null,
				updatedAt: new Date(999_000)
			},
			database
		);
		const after = await client.execute({
			sql: 'select * from tracks where public_id = ?',
			args: [track.publicId]
		});

		expect(result).toBeNull();
		expect(after.rows[0]).toEqual(before.rows[0]);
	});

	it('keeps the stored filename server-only and owner-scoped for deletion', async () => {
		const [track] = await listTracksByOwner(OWNER_ID, database);

		await expect(
			findOwnedTrackFileByPublicId(track.publicId, OTHER_ID, database)
		).resolves.toBeNull();
		await expect(
			findOwnedTrackFileByPublicId(track.publicId, OWNER_ID, database)
		).resolves.toEqual({
			publicId: track.publicId,
			storedFilename: '00000000-0000-4000-8000-000000000002.mp3'
		});
	});

	it('deletes only with the matching owner and public ID', async () => {
		const [track] = await listTracksByOwner(OWNER_ID, database);

		await expect(
			deleteOwnedTrackRecord(track.publicId, OTHER_ID, database)
		).resolves.toBe(false);
		await expect(
			findOwnedTrackByPublicId(track.publicId, OWNER_ID, database)
		).resolves.not.toBeNull();
		await expect(
			deleteOwnedTrackRecord(track.publicId, OWNER_ID, database)
		).resolves.toBe(true);
		await expect(
			findOwnedTrackByPublicId(track.publicId, OWNER_ID, database)
		).resolves.toBeNull();

		const otherRows = await client.execute({
			sql: 'select count(*) as count from tracks where owner_id = ?',
			args: [OTHER_ID]
		});
		expect(Number(otherRows.rows[0].count)).toBe(1);
	});
});

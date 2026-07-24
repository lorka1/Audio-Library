import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '$lib/server/db/schema';
import type { TrackSearchFilters } from '$lib/tracks-query';
import type { CreateTrackInput } from './repository';

const databaseMocks = vi.hoisted(() => ({
	insert: vi.fn(),
	values: vi.fn(),
	returning: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	db: {
		insert: databaseMocks.insert
	}
}));

import { createTrack, listPublicTracks } from './repository';

const NOW = new Date('2026-07-24T17:00:00.000Z');
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const PRIVATE_INTERNAL_ID = '99999999-9999-4999-8999-999999999999';

function trackInput(): CreateTrackInput {
	return {
		id: 'track-id',
		ownerId: 'authenticated-owner-id',
		title: 'Public track',
		artist: 'Test Artist',
		bpm: 124,
		musicalKey: 'C minor',
		genre: 'Techno',
		description: null,
		originalFilename: 'original.mp3',
		storageKey: '550e8400-e29b-41d4-a716-446655440000.mp3',
		mimeType: 'audio/mpeg',
		fileSizeBytes: 1024,
		createdAt: NOW,
		updatedAt: NOW
	};
}

function filters(overrides: Partial<TrackSearchFilters> = {}): TrackSearchFilters {
	return {
		sort: 'newest',
		...overrides
	};
}

function openTestDatabase(client: Client) {
	return drizzle({ client, schema });
}

type TestDatabase = ReturnType<typeof openTestDatabase>;

let testClient: Client;
let testDatabase: TestDatabase;

interface SeedTrack {
	id: string;
	title: string;
	artist: string;
	bpm: number | null;
	musicalKey: string | null;
	genre: string | null;
	description: string | null;
	visibility: 'public' | 'private';
	createdAt: number;
}

const seedTracks: SeedTrack[] = [
	{
		id: '00000000-0000-4000-8000-000000000001',
		title: 'Zulu Beat',
		artist: 'Alpha Artist',
		bpm: 140,
		musicalKey: 'A minor',
		genre: 'House',
		description: 'A sunset festival recording.',
		visibility: 'public',
		createdAt: 1_000
	},
	{
		id: '00000000-0000-4000-8000-000000000002',
		title: 'alpha pulse',
		artist: 'BETA CREW',
		bpm: 90,
		musicalKey: 'C major',
		genre: 'Jazz',
		description: null,
		visibility: 'public',
		createdAt: 2_000
	},
	{
		id: '00000000-0000-4000-8000-000000000003',
		title: 'Croatian Night',
		artist: 'Zeljko',
		bpm: 120,
		musicalKey: 'A minor',
		genre: 'House',
		description: 'A late night party session.',
		visibility: 'public',
		createdAt: 3_000
	},
	{
		id: '00000000-0000-4000-8000-000000000004',
		title: 'Percent 100%_mix',
		artist: 'Literal_Artist',
		bpm: null,
		musicalKey: 'D minor',
		genre: 'Electronic',
		description: 'A Back\\slash texture.',
		visibility: 'public',
		createdAt: 4_000
	},
	{
		id: PRIVATE_INTERNAL_ID,
		title: 'Private alpha needle 100%_mix',
		artist: 'Alpha Artist',
		bpm: 110,
		musicalKey: 'A minor',
		genre: 'House',
		description: 'A private sunset needle.',
		visibility: 'private',
		createdAt: 9_000
	},
	{
		id: '00000000-0000-4000-8000-000000000006',
		title: 'Bravo',
		artist: 'Gamma',
		bpm: 120,
		musicalKey: 'A minor',
		genre: 'House',
		description: 'The combined needle track.',
		visibility: 'public',
		createdAt: 3_000
	},
	{
		id: '00000000-0000-4000-8000-000000000007',
		title: "Quote's Song",
		artist: 'Delta',
		bpm: 130,
		musicalKey: 'E minor',
		genre: 'Rock',
		description: 'Ordinary quoted text.',
		visibility: 'public',
		createdAt: 5_000
	}
];

async function seedRepositoryDatabase(): Promise<void> {
	await testClient.execute(`
		create table users (
			id text primary key not null,
			email text not null,
			username text not null,
			password_hash text not null,
			created_at integer not null,
			updated_at integer not null
		)
	`);
	await testClient.execute(`
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
	await testClient.execute({
		sql: 'insert into users (id, email, username, password_hash, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
		args: [OWNER_ID, 'owner@example.test', 'repository_owner', 'not-a-real-hash', 1_000, 1_000]
	});

	for (const [index, track] of seedTracks.entries()) {
		await testClient.execute({
			sql: `insert into tracks (
				id, owner_id, title, artist, bpm, musical_key, genre, description,
				original_filename, storage_key, mime_type, file_size_bytes,
				duration_ms, visibility, created_at, updated_at
			) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				track.id,
				OWNER_ID,
				track.title,
				track.artist,
				track.bpm,
				track.musicalKey,
				track.genre,
				track.description,
				`original-${index}.mp3`,
				`00000000-0000-4000-8000-${String(index).padStart(12, '0')}.mp3`,
				'audio/mpeg',
				100 + index,
				null,
				track.visibility,
				track.createdAt,
				track.createdAt
			]
		});
	}
}

function titles(records: Awaited<ReturnType<typeof listPublicTracks>>): string[] {
	return records.map((track) => track.title);
}

function expectPrivateExcluded(records: Awaited<ReturnType<typeof listPublicTracks>>): void {
	expect(titles(records)).not.toContain('Private alpha needle 100%_mix');
	expect(JSON.stringify(records)).not.toContain(PRIVATE_INTERNAL_ID);
}

beforeAll(async () => {
	testClient = createClient({ url: ':memory:' });
	testDatabase = openTestDatabase(testClient);
	await seedRepositoryDatabase();
});

afterAll(() => {
	testClient.close();
});

describe('createTrack', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		databaseMocks.insert.mockReturnValue({ values: databaseMocks.values });
		databaseMocks.values.mockReturnValue({ returning: databaseMocks.returning });
		databaseMocks.returning.mockResolvedValue([
			{ id: 42, title: 'Public track', createdAt: NOW }
		]);
	});

	it('keeps the authenticated owner and inserts new uploads as public', async () => {
		const input = trackInput();

		await createTrack(input);

		expect(databaseMocks.values).toHaveBeenCalledWith({
			...input,
			visibility: 'public'
		});
	});
});

describe('listPublicTracks search and filters', () => {
	it.each([
		['title', filters({ q: 'pulse' }), ['alpha pulse']],
		['artist', filters({ q: 'beta crew' }), ['alpha pulse']],
		['description', filters({ q: 'sunset festival' }), ['Zulu Beat']]
	])('matches partial %s text', async (_field, query, expected) => {
		const records = await listPublicTracks(query, testDatabase);

		expect(titles(records)).toEqual(expected);
		expectPrivateExcluded(records);
	});

	it('matches title, artist, and description without ASCII case sensitivity', async () => {
		const titleMatches = await listPublicTracks(filters({ q: 'ALPHA PULSE' }), testDatabase);
		const artistMatches = await listPublicTracks(filters({ q: 'beta crew' }), testDatabase);
		const descriptionMatches = await listPublicTracks(filters({ q: 'SUNSET' }), testDatabase);

		expect(titles(titleMatches)).toEqual(['alpha pulse']);
		expect(titles(artistMatches)).toEqual(['alpha pulse']);
		expect(titles(descriptionMatches)).toEqual(['Zulu Beat']);
	});

	it.each([
		[{ bpmMin: 120 }, ["Quote's Song", 'Bravo', 'Croatian Night', 'Zulu Beat']],
		[{ bpmMax: 120 }, ['Bravo', 'Croatian Night', 'alpha pulse']],
		[{ bpmMin: 100, bpmMax: 130 }, ["Quote's Song", 'Bravo', 'Croatian Night']]
	])('applies BPM bounds %j inclusively', async (bpmFilters, expected) => {
		const records = await listPublicTracks(filters(bpmFilters), testDatabase);

		expect(titles(records)).toEqual(expected);
		expect(records.every((track) => track.bpm !== null)).toBe(true);
		expectPrivateExcluded(records);
	});

	it('filters by exact musical key', async () => {
		const records = await listPublicTracks(filters({ musicalKey: 'A minor' }), testDatabase);

		expect(titles(records)).toEqual(['Bravo', 'Croatian Night', 'Zulu Beat']);
		expect(records.every((track) => track.musicalKey === 'A minor')).toBe(true);
		expectPrivateExcluded(records);
	});

	it('filters by exact genre', async () => {
		const records = await listPublicTracks(filters({ genre: 'House' }), testDatabase);

		expect(titles(records)).toEqual(['Bravo', 'Croatian Night', 'Zulu Beat']);
		expect(records.every((track) => track.genre === 'House')).toBe(true);
		expectPrivateExcluded(records);
	});

	it('combines text, BPM, key, and genre with public visibility', async () => {
		const records = await listPublicTracks(
			filters({
				q: 'needle',
				bpmMin: 100,
				bpmMax: 125,
				musicalKey: 'A minor',
				genre: 'House'
			}),
			testDatabase
		);

		expect(titles(records)).toEqual(['Bravo']);
		expectPrivateExcluded(records);
	});

	it.each([
		['%', ['Percent 100%_mix']],
		['_mix', ['Percent 100%_mix']],
		['Back\\slash', ['Percent 100%_mix']],
		["Quote's", ["Quote's Song"]]
	])('treats LIKE and quote characters literally in %s', async (q, expected) => {
		const records = await listPublicTracks(filters({ q }), testDatabase);

		expect(titles(records)).toEqual(expected);
		expectPrivateExcluded(records);
	});
});

describe('listPublicTracks sorting and projection', () => {
	it('sorts newest first with public ID as a stable descending tie-breaker', async () => {
		const records = await listPublicTracks(filters({ sort: 'newest' }), testDatabase);

		expect(titles(records)).toEqual([
			"Quote's Song",
			'Percent 100%_mix',
			'Bravo',
			'Croatian Night',
			'alpha pulse',
			'Zulu Beat'
		]);
		expectPrivateExcluded(records);
	});

	it('sorts oldest first with public ID as a stable ascending tie-breaker', async () => {
		const records = await listPublicTracks(filters({ sort: 'oldest' }), testDatabase);

		expect(titles(records)).toEqual([
			'Zulu Beat',
			'alpha pulse',
			'Croatian Night',
			'Bravo',
			'Percent 100%_mix',
			"Quote's Song"
		]);
		expectPrivateExcluded(records);
	});

	it('sorts titles case-insensitively with a stable public ID tie-breaker', async () => {
		const records = await listPublicTracks(filters({ sort: 'title_asc' }), testDatabase);

		expect(titles(records)).toEqual([
			'alpha pulse',
			'Bravo',
			'Croatian Night',
			'Percent 100%_mix',
			"Quote's Song",
			'Zulu Beat'
		]);
		expectPrivateExcluded(records);
	});

	it('sorts numeric BPM ascending and places null BPM last', async () => {
		const records = await listPublicTracks(filters({ sort: 'bpm_asc' }), testDatabase);

		expect(records.map((track) => track.bpm)).toEqual([90, 120, 120, 130, 140, null]);
		expect(titles(records).slice(1, 3)).toEqual(['Croatian Night', 'Bravo']);
		expectPrivateExcluded(records);
	});

	it('sorts numeric BPM descending and still places null BPM last', async () => {
		const records = await listPublicTracks(filters({ sort: 'bpm_desc' }), testDatabase);

		expect(records.map((track) => track.bpm)).toEqual([140, 130, 120, 120, 90, null]);
		expect(titles(records).slice(2, 4)).toEqual(['Croatian Night', 'Bravo']);
		expectPrivateExcluded(records);
	});

	it('keeps the explicit safe public projection unchanged', async () => {
		const [record] = await listPublicTracks(filters({ q: 'Zulu Beat' }), testDatabase);

		expect(Object.keys(record).sort()).toEqual([
			'artist',
			'bpm',
			'createdAt',
			'description',
			'fileSizeBytes',
			'genre',
			'id',
			'musicalKey',
			'ownerUsername',
			'title',
			'updatedAt'
		]);
		expect(typeof record.id).toBe('number');
		expect(record.ownerUsername).toBe('repository_owner');
		expect(JSON.stringify(record)).not.toContain(OWNER_ID);
		expect(JSON.stringify(record)).not.toContain('storage_key');
		expect(JSON.stringify(record)).not.toContain('.mp3');
	});
});

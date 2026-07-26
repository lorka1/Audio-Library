import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
	vi
} from 'vitest';
import * as schema from '$lib/server/db/schema';

vi.mock('$lib/server/db', () => ({ db: {} }));

import {
	createSqliteUserRepository,
	type SqliteUserDatabase
} from './sqlite-repository';

let client: Client;
let repository: ReturnType<typeof createSqliteUserRepository>;

const input = {
	id: '11111111-1111-4111-8111-111111111111',
	username: 'sqlite_fixture_user',
	email: 'sqlite.fixture@example.test',
	passwordHash: 'synthetic-server-only-hash'
};

beforeAll(async () => {
	client = createClient({ url: ':memory:' });
	await client.execute(`
		create table users (
			id text primary key not null,
			email text not null,
			username text not null,
			password_hash text not null,
			created_at integer not null default (unixepoch()),
			updated_at integer not null default (unixepoch())
		)
	`);
	await client.execute(
		'create unique index users_email_unique on users (email)'
	);
	await client.execute(
		'create unique index users_username_unique on users (username)'
	);
	const database = drizzle({ client, schema });
	repository = createSqliteUserRepository(
		database as unknown as SqliteUserDatabase
	);
	await repository.createUser(input);
});

afterAll(() => {
	client.close();
});

describe('SQLite user repository contract', () => {
	it('creates users and exposes distinct safe projections', async () => {
		const created = await repository.findUserById(input.id);
		expect(created).toMatchObject({
			id: input.id,
			username: input.username,
			email: input.email
		});
		expect(created).not.toBeNull();
		expect(created).not.toHaveProperty('passwordHash');

		await expect(repository.findUserById(input.id)).resolves.toEqual(
			created
		);
		await expect(
			repository.findUserByNormalizedUsername(input.username)
		).resolves.toEqual(created);
		await expect(
			repository.findUserByNormalizedEmail(input.email)
		).resolves.toEqual(created);

		const authentication =
			await repository.findAuthenticationUser(input.email);
		expect(authentication).toEqual({
			id: input.id,
			passwordHash: input.passwordHash
		});
		expect(authentication).not.toHaveProperty('email');

		const account = await repository.findAccountUserById(input.id);
		expect(account).toEqual({
			username: input.username,
			email: input.email,
			createdAt: created?.createdAt
		});
		expect(account).not.toHaveProperty('id');
	});

	it.each([
		[
			'username',
			{
				...input,
				id: '22222222-2222-4222-8222-222222222222',
				email: 'sqlite.second@example.test'
			}
		],
		[
			'email',
			{
				...input,
				id: '33333333-3333-4333-8333-333333333333',
				username: 'sqlite_fixture_second'
			}
		]
	] as const)('maps a duplicate %s to the domain error', async (field, duplicate) => {
		await expect(repository.createUser(duplicate)).rejects.toMatchObject({
			name: 'DuplicateUserError',
			field
		});
	});
});

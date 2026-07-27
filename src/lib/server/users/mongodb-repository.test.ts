import {
	MongoServerError,
	type Collection
} from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import type { UserDocument } from '../mongodb/documents';
import { createMongoUserRepository } from './mongodb-repository';
import { DuplicateUserError } from './types';

const now = new Date('2026-07-26T12:00:00.000Z');
const input = {
	id: '11111111-1111-4111-8111-111111111111',
	username: 'fixture_user',
	email: 'fixture@example.test',
	passwordHash: 'synthetic-server-only-hash'
};
const document: UserDocument = {
	_id: input.id,
	username: input.username,
	email: input.email,
	passwordHash: input.passwordHash,
	createdAt: now,
	updatedAt: now
};

function fakeCollection() {
	return {
		insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
		findOne: vi.fn()
	} as unknown as Collection<UserDocument>;
}

describe('MongoDB user repository', () => {
	it('creates UUID-keyed documents and returns only a safe user model', async () => {
		const users = fakeCollection();
		const repository = createMongoUserRepository(users, {
			timeoutMS: 2_000,
			now: () => now
		});

		await expect(repository.createUser(input)).resolves.toEqual({
			id: input.id,
			username: input.username,
			email: input.email,
			createdAt: now
		});
		expect(users.insertOne).toHaveBeenCalledWith(document, {
			timeoutMS: 2_000,
			signal: undefined,
			session: undefined
		});
		expect(await repository.createUser(input)).not.toHaveProperty(
			'passwordHash'
		);
	});

	it('uses explicit safe, authentication-only, and account-safe projections', async () => {
		const users = fakeCollection();
		vi.mocked(users.findOne).mockResolvedValue(document);
		const repository = createMongoUserRepository(users);

		await expect(repository.findUserById(input.id)).resolves.toEqual({
			id: input.id,
			username: input.username,
			email: input.email,
			createdAt: now
		});
		await expect(
			repository.findAuthenticationUser(input.email)
		).resolves.toEqual({
			id: input.id,
			passwordHash: input.passwordHash
		});
		await expect(
			repository.findAccountUserById(input.id)
		).resolves.toEqual({
			username: input.username,
			email: input.email,
			createdAt: now
		});

		const calls = vi.mocked(users.findOne).mock.calls;
		expect(calls[0]?.[1]?.projection).toEqual({
			_id: 1,
			username: 1,
			email: 1,
			createdAt: 1
		});
		expect(calls[1]?.[1]?.projection).toEqual({
			_id: 1,
			passwordHash: 1
		});
		expect(calls[2]?.[1]?.projection).toEqual({
			_id: 0,
			username: 1,
			email: 1,
			createdAt: 1
		});
	});

	it.each(['username', 'email'] as const)(
		'maps a duplicate %s index safely',
		async (field) => {
			const users = fakeCollection();
			vi.mocked(users.insertOne).mockRejectedValue(
				new MongoServerError({
					message: 'synthetic duplicate',
					code: 11000,
					keyPattern: { [field]: 1 }
				})
			);
			const repository = createMongoUserRepository(users);

			await expect(repository.createUser(input)).rejects.toMatchObject({
				name: 'DuplicateUserError',
				field
			} satisfies Partial<DuplicateUserError>);
		}
	);
});

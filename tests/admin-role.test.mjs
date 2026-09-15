import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeUserRole } from '../src/lib/types/index.ts';
import {
	requireAdmin,
	resolvePostLoginRedirect
} from '../src/lib/server/auth/guards.ts';
import { createMongoUserRepository } from '../src/lib/server/users/mongodb-repository.ts';

const createdAt = new Date('2026-01-02T03:04:05.000Z');

function requestEvent(user) {
	return {
		locals: { user },
		url: new URL('https://audio.example.test/admin')
	};
}

test('missing and unknown roles are treated as normal users', () => {
	assert.equal(normalizeUserRole(undefined), 'user');
	assert.equal(normalizeUserRole('superadmin'), 'user');
	assert.equal(normalizeUserRole('admin'), 'admin');
});

test('post-login redirect sends admins to admin and preserves normal user behavior', () => {
	assert.equal(resolvePostLoginRedirect('admin', '/tracks?sort=oldest'), '/admin');
	assert.equal(resolvePostLoginRedirect('user', '/tracks?sort=oldest'), '/tracks?sort=oldest');
});

test('user creation always persists the user role even if an extra role is supplied', async () => {
	let insertedDocument;
	const users = {
		async insertOne(document) {
			insertedDocument = document;
		}
	};
	const repository = createMongoUserRepository(users, { now: () => createdAt });

	const user = await repository.createUser({
		id: 'user-1',
		username: 'listener',
		email: 'listener@example.test',
		passwordHash: 'not-a-plaintext-password',
		role: 'admin'
	});

	assert.equal(insertedDocument.role, 'user');
	assert.equal(user.role, 'user');
});

test('requireAdmin permits administrators and rejects normal users', () => {
	const admin = {
		id: 'admin-1',
		username: 'moderator',
		email: 'moderator@example.test',
		role: 'admin',
		createdAt
	};
	const user = { ...admin, id: 'user-1', role: 'user' };

	assert.equal(requireAdmin(requestEvent(admin)), admin);
	assert.throws(
		() => requireAdmin(requestEvent(user)),
		(error) => error?.status === 403
	);
});

test('requireAdmin redirects unauthenticated requests to the shared login page', () => {
	assert.throws(
		() => requireAdmin(requestEvent(null)),
		(error) =>
			error?.status === 303 &&
			error?.location === '/login?redirectTo=%2Fadmin'
	);
});

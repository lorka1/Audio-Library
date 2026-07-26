import { describe, expect, it } from 'vitest';
import type { CurrentUser } from '$lib/types';
import { toAccountUser } from './account-user';

describe('toAccountUser', () => {
	it('keeps owner-visible account details without serializing the internal user ID', () => {
		const user: CurrentUser = {
			id: '11111111-1111-4111-8111-111111111111',
			username: 'account_owner',
			email: 'account-owner@example.test',
			createdAt: new Date('2026-07-26T12:00:00.000Z')
		};

		const accountUser = toAccountUser(user);

		expect(accountUser).toEqual({
			username: user.username,
			email: user.email,
			createdAt: user.createdAt
		});
		expect(Object.keys(accountUser)).toEqual(['username', 'email', 'createdAt']);
		expect(JSON.stringify(accountUser)).not.toContain(user.id);
	});
});

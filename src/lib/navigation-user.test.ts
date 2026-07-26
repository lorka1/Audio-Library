import { describe, expect, it } from 'vitest';
import type { CurrentUser } from '$lib/types';
import { toNavigationUser } from './navigation-user';

describe('toNavigationUser', () => {
	it('projects an authenticated user without serializing internal identity data', () => {
		const user: CurrentUser = {
			id: '11111111-1111-4111-8111-111111111111',
			username: 'phase6_owner',
			email: 'phase6-owner@example.test',
			createdAt: new Date('2026-07-26T12:00:00.000Z')
		};

		const navigationUser = toNavigationUser(user);
		const serialized = JSON.stringify(navigationUser);

		expect(navigationUser).toEqual({ username: 'phase6_owner' });
		expect(serialized).not.toContain(user.id);
		expect(serialized).not.toContain(user.email);
	});

	it('preserves the signed-out state', () => {
		expect(toNavigationUser(null)).toBeNull();
	});
});

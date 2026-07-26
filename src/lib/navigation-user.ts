import type { CurrentUser, NavigationUser } from '$lib/types';

export function toNavigationUser(user: CurrentUser | null): NavigationUser | null {
	return user ? { username: user.username } : null;
}

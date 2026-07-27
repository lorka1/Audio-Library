import type { CurrentUser } from '$lib/types';
import type { AuthSession } from '$lib/server/auth/types';

declare global {
	namespace App {
		interface Locals {
			user: CurrentUser | null;
			session: AuthSession | null;
			requestId: string;
		}
	}
}

export {};

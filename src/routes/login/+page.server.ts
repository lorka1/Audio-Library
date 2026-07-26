import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireGuest } from '$lib/server/auth/guards';
import { logAuthError } from '$lib/server/auth/logging';
import {
	performDummyPasswordCheck,
	verifyPassword
} from '$lib/server/auth/password';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { findAuthenticationUser } from '$lib/server/users/repository';
import {
	getSafeRedirectPath,
	readFormString,
	validateLoginInput,
	type LoginErrors,
	type LoginValues
} from '$lib/server/auth/validation';

interface LoginFailure {
	values: LoginValues;
	errors: LoginErrors;
	message: string | null;
}

function loginFailure(
	values: LoginValues,
	errors: LoginErrors,
	message: string | null = null
): LoginFailure {
	return { values, errors, message };
}

export const load = ((event) => {
	requireGuest(event);

	return {
		redirectTo: getSafeRedirectPath(event.url.searchParams.get('redirectTo'))
	};
}) satisfies PageServerLoad;

export const actions = {
	default: async (event) => {
		requireGuest(event);

		const formData = await event.request.formData();
		const redirectTo = getSafeRedirectPath(readFormString(formData, 'redirectTo'));
		const validation = validateLoginInput({
			email: readFormString(formData, 'email'),
			password: readFormString(formData, 'password')
		});

		if (!validation.success) {
			return fail(400, loginFailure(validation.values, validation.errors));
		}

		const values = { email: validation.data.email };

		try {
			const user = await findAuthenticationUser(values.email);

			if (!user) {
				await performDummyPasswordCheck(validation.data.password);
				return fail(
					400,
					loginFailure(values, {}, 'Email or password is incorrect.')
				);
			}

			const passwordMatches = await verifyPassword(
				validation.data.password,
				user.passwordHash
			);

			if (!passwordMatches) {
				return fail(
					400,
					loginFailure(values, {}, 'Email or password is incorrect.')
				);
			}

			const { token, session } = await createSession(user.id);
			setSessionCookie(event.cookies, token, session.expiresAt);
		} catch (error) {
			logAuthError('Login failed.', error);
			return fail(
				500,
				loginFailure(values, {}, 'Login is temporarily unavailable. Please try again.')
			);
		}

		redirect(303, redirectTo);
	}
} satisfies Actions;

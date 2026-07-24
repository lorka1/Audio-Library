import { randomUUID } from 'node:crypto';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireGuest } from '$lib/server/auth/guards';
import { logAuthError } from '$lib/server/auth/logging';
import { hashPassword } from '$lib/server/auth/password';
import {
	createUserWithSession,
	findRegistrationConflicts
} from '$lib/server/auth/repository';
import { prepareSession, setSessionCookie } from '$lib/server/auth/session';
import {
	readFormString,
	validateRegistrationInput,
	type RegistrationErrors,
	type RegistrationValues
} from '$lib/server/auth/validation';

interface RegistrationFailure {
	values: RegistrationValues;
	errors: RegistrationErrors;
	message: string | null;
}

function registrationFailure(
	values: RegistrationValues,
	errors: RegistrationErrors,
	message: string | null = null
): RegistrationFailure {
	return { values, errors, message };
}

export const load = ((event) => {
	requireGuest(event);
	return {};
}) satisfies PageServerLoad;

export const actions = {
	default: async (event) => {
		requireGuest(event);

		const formData = await event.request.formData();
		const validation = validateRegistrationInput({
			username: readFormString(formData, 'username'),
			email: readFormString(formData, 'email'),
			password: readFormString(formData, 'password'),
			confirmPassword: readFormString(formData, 'confirmPassword')
		});

		if (!validation.success) {
			return fail(400, registrationFailure(validation.values, validation.errors));
		}

		const values = {
			username: validation.data.username,
			email: validation.data.email
		};

		try {
			const conflicts = await findRegistrationConflicts(values.username, values.email);
			const errors: RegistrationErrors = {};

			if (conflicts.usernameTaken) {
				errors.username = 'That username is already in use.';
			}

			if (conflicts.emailTaken) {
				errors.email = 'An account with that email already exists.';
			}

			if (Object.keys(errors).length > 0) {
				return fail(409, registrationFailure(values, errors));
			}

			const userId = randomUUID();
			const passwordHash = await hashPassword(validation.data.password);
			const preparedSession = prepareSession(userId);
			const { session } = await createUserWithSession(
				{
					id: userId,
					username: values.username,
					email: values.email,
					passwordHash
				},
				preparedSession.record
			);

			setSessionCookie(event.cookies, preparedSession.token, session.expiresAt);
		} catch (error) {
			try {
				const conflicts = await findRegistrationConflicts(values.username, values.email);
				const errors: RegistrationErrors = {};

				if (conflicts.usernameTaken) {
					errors.username = 'That username is already in use.';
				}

				if (conflicts.emailTaken) {
					errors.email = 'An account with that email already exists.';
				}

				if (Object.keys(errors).length > 0) {
					return fail(409, registrationFailure(values, errors));
				}
			} catch (conflictError) {
				logAuthError('Registration conflict lookup failed.', conflictError);
			}

			logAuthError('Registration failed.', error);
			return fail(
				500,
				registrationFailure(
					values,
					{},
					'Your account could not be created right now. Please try again.'
				)
			);
		}

		redirect(303, '/');
	}
} satisfies Actions;

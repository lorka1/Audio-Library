import { truncates } from 'bcryptjs';

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const EMAIL_MAX_LENGTH = 254;

const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RegistrationField = 'username' | 'email' | 'password' | 'confirmPassword';
export type RegistrationErrors = Partial<Record<RegistrationField, string>>;
export type LoginField = 'email' | 'password';
export type LoginErrors = Partial<Record<LoginField, string>>;

export interface RegistrationValues {
	username: string;
	email: string;
}

export interface LoginValues {
	email: string;
}

interface RegistrationInput {
	username: string;
	email: string;
	password: string;
	confirmPassword: string;
}

interface LoginInput {
	email: string;
	password: string;
}

export type RegistrationValidationResult =
	| {
			success: true;
			data: RegistrationValues & { password: string };
	  }
	| {
			success: false;
			values: RegistrationValues;
			errors: RegistrationErrors;
	  };

export type LoginValidationResult =
	| {
			success: true;
			data: LoginValues & { password: string };
	  }
	| {
			success: false;
			values: LoginValues;
			errors: LoginErrors;
	  };

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function readFormString(formData: FormData, field: string): string {
	const value = formData.get(field);
	return typeof value === 'string' ? value : '';
}

export function validateUsername(username: string): string | null {
	if (!username) {
		return 'Username is required.';
	}

	if (username.length < USERNAME_MIN_LENGTH) {
		return `Username must be at least ${USERNAME_MIN_LENGTH} characters.`;
	}

	if (username.length > USERNAME_MAX_LENGTH) {
		return `Username must be at most ${USERNAME_MAX_LENGTH} characters.`;
	}

	if (!USERNAME_PATTERN.test(username)) {
		return 'Username may only contain letters, numbers, and underscores.';
	}

	return null;
}

export function validateEmail(email: string): string | null {
	if (!email) {
		return 'Email is required.';
	}

	if (email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
		return 'Enter a valid email address.';
	}

	return null;
}

export function validatePassword(password: string): string | null {
	if (!password) {
		return 'Password is required.';
	}

	if (password.length < PASSWORD_MIN_LENGTH) {
		return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
	}

	if (password.length > PASSWORD_MAX_LENGTH) {
		return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
	}

	if (truncates(password)) {
		return 'Password must not exceed 72 UTF-8 bytes.';
	}

	return null;
}

export function validateRegistrationInput(
	input: RegistrationInput
): RegistrationValidationResult {
	const values = {
		username: input.username.trim(),
		email: normalizeEmail(input.email)
	};
	const errors: RegistrationErrors = {};

	const usernameError = validateUsername(values.username);
	const emailError = validateEmail(values.email);
	const passwordError = validatePassword(input.password);

	if (usernameError) errors.username = usernameError;
	if (emailError) errors.email = emailError;
	if (passwordError) errors.password = passwordError;

	if (!input.confirmPassword) {
		errors.confirmPassword = 'Confirm your password.';
	} else if (input.password !== input.confirmPassword) {
		errors.confirmPassword = 'Passwords do not match.';
	}

	if (Object.keys(errors).length > 0) {
		return { success: false, values, errors };
	}

	return {
		success: true,
		data: {
			...values,
			password: input.password
		}
	};
}

export function validateLoginInput(input: LoginInput): LoginValidationResult {
	const values = {
		email: normalizeEmail(input.email)
	};
	const errors: LoginErrors = {};

	const emailError = validateEmail(values.email);
	if (emailError) errors.email = emailError;

	if (!input.password) {
		errors.password = 'Password is required.';
	} else if (input.password.length > PASSWORD_MAX_LENGTH || truncates(input.password)) {
		errors.password = 'Email or password is incorrect.';
	}

	if (Object.keys(errors).length > 0) {
		return { success: false, values, errors };
	}

	return {
		success: true,
		data: {
			...values,
			password: input.password
		}
	};
}

export function getSafeRedirectPath(value: string | null | undefined, fallback = '/'): string {
	if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
		return fallback;
	}

	try {
		const decodedPath = decodeURIComponent(value);

		if (decodedPath.startsWith('//') || decodedPath.includes('\\')) {
			return fallback;
		}

		const parsedPath = new URL(value, 'http://local.invalid');
		return parsedPath.origin === 'http://local.invalid' ? value : fallback;
	} catch {
		return fallback;
	}
}

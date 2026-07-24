import { describe, expect, it } from 'vitest';
import {
	getSafeRedirectPath,
	normalizeEmail,
	validateEmail,
	validateLoginInput,
	validatePassword,
	validateRegistrationInput,
	validateUsername
} from './validation';

describe('normalizeEmail', () => {
	it('trims whitespace and lowercases the address', () => {
		expect(normalizeEmail('  Test.User@Example.COM  ')).toBe('test.user@example.com');
	});
});

describe('validateUsername', () => {
	it.each(['abc', 'user_123', 'A'.repeat(30)])('accepts a valid username: %s', (username) => {
		expect(validateUsername(username)).toBeNull();
	});

	it.each([
		['', 'Username is required.'],
		['ab', 'Username must be at least 3 characters.'],
		['A'.repeat(31), 'Username must be at most 30 characters.'],
		['user-name', 'Username may only contain letters, numbers, and underscores.'],
		['user name', 'Username may only contain letters, numbers, and underscores.']
	])('rejects an invalid username', (username, message) => {
		expect(validateUsername(username)).toBe(message);
	});
});

describe('validateEmail', () => {
	it('accepts a basic valid email address', () => {
		expect(validateEmail('user@example.com')).toBeNull();
	});

	it.each(['', 'user', 'user@', '@example.com', 'user@example'])(
		'rejects an invalid email address: %s',
		(email) => {
			expect(validateEmail(email)).not.toBeNull();
		}
	);
});

describe('validatePassword', () => {
	it('accepts an eight-character password', () => {
		expect(validatePassword('12345678')).toBeNull();
	});

	it('rejects a password shorter than eight characters', () => {
		expect(validatePassword('1234567')).toBe('Password must be at least 8 characters.');
	});

	it('rejects a password longer than the configured character limit', () => {
		expect(validatePassword('A'.repeat(129))).toBe('Password must be at most 128 characters.');
	});

	it('rejects input that bcrypt would silently truncate', () => {
		expect(validatePassword('A'.repeat(73))).toBe('Password must not exceed 72 UTF-8 bytes.');
	});
});

describe('registration validation', () => {
	it('rejects mismatched passwords without returning either password', () => {
		const result = validateRegistrationInput({
			username: 'test_user',
			email: 'test@example.com',
			password: 'test-only-password',
			confirmPassword: 'different-test-password'
		});

		expect(result.success).toBe(false);

		if (!result.success) {
			expect(result.errors.confirmPassword).toBe('Passwords do not match.');
			expect(result.values).toEqual({
				username: 'test_user',
				email: 'test@example.com'
			});
			expect(result).not.toHaveProperty('password');
			expect(result).not.toHaveProperty('confirmPassword');
		}
	});
});

describe('login validation', () => {
	it('never returns a password when validation fails', () => {
		const result = validateLoginInput({
			email: 'invalid-email',
			password: 'synthetic-test-password'
		});

		expect(result.success).toBe(false);

		if (!result.success) {
			expect(result.values).toEqual({ email: 'invalid-email' });
			expect(result).not.toHaveProperty('password');
		}
	});

	it('rejects a password that bcrypt would truncate', () => {
		const result = validateLoginInput({
			email: 'test@example.com',
			password: 'A'.repeat(73)
		});

		expect(result.success).toBe(false);

		if (!result.success) {
			expect(result.errors.password).toBe('Email or password is incorrect.');
		}
	});
});

describe('safe redirects', () => {
	it('allows internal paths and rejects external or backslash paths', () => {
		expect(getSafeRedirectPath('/account')).toBe('/account');
		expect(getSafeRedirectPath('//example.com')).toBe('/');
		expect(getSafeRedirectPath('/\\example.com')).toBe('/');
		expect(getSafeRedirectPath('/%5C%5Cexample.com')).toBe('/');
		expect(getSafeRedirectPath('https://example.com')).toBe('/');
	});
});

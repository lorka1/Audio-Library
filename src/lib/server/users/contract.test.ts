import { describe, expect, it } from 'vitest';
import { assertNormalizedCreateUserInput } from './contract';

const validInput = {
	id: '11111111-1111-4111-8111-111111111111',
	username: 'fixture_user',
	email: 'fixture@example.test',
	passwordHash: 'synthetic-server-only-hash'
};

describe('user repository input contract', () => {
	it('accepts validated normalized values and server-only fields', () => {
		expect(() =>
			assertNormalizedCreateUserInput(validInput)
		).not.toThrow();
	});

	it.each([
		{ username: ' fixture_user ' },
		{ username: 'invalid user' },
		{ email: 'Fixture@Example.test' },
		{ email: ' fixture@example.test ' },
		{ email: 'invalid-email' },
		{ id: '' },
		{ passwordHash: '' }
	])('rejects a non-normalized or incomplete input', (override) => {
		expect(() =>
			assertNormalizedCreateUserInput({
				...validInput,
				...override
			})
		).toThrow();
	});
});

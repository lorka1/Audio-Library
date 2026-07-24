import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
	it('verifies the correct password and rejects a different one', async () => {
		const passwordHash = await hashPassword('synthetic-test-password');

		await expect(verifyPassword('synthetic-test-password', passwordHash)).resolves.toBe(true);
		await expect(verifyPassword('different-test-password', passwordHash)).resolves.toBe(false);
	});

	it('uses a fresh salt for every hash', async () => {
		const [firstHash, secondHash] = await Promise.all([
			hashPassword('same-synthetic-password'),
			hashPassword('same-synthetic-password')
		]);

		expect(firstHash).not.toBe(secondHash);
		await expect(verifyPassword('same-synthetic-password', firstHash)).resolves.toBe(true);
		await expect(verifyPassword('same-synthetic-password', secondHash)).resolves.toBe(true);
	});
});

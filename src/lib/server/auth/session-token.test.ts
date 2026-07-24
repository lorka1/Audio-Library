import { describe, expect, it } from 'vitest';
import {
	generateSessionToken,
	hashSessionToken,
	isSessionToken
} from './session-token';

describe('session tokens', () => {
	it('generates a correctly shaped cryptographically random token', () => {
		const token = generateSessionToken();

		expect(token).toHaveLength(43);
		expect(isSessionToken(token)).toBe(true);
	});

	it('produces a stable SHA-256 hash for the same token', () => {
		const token = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

		expect(hashSessionToken(token)).toBe(hashSessionToken(token));
		expect(hashSessionToken(token)).toMatch(/^[a-f0-9]{64}$/);
	});

	it('produces different hashes for different tokens', () => {
		const firstToken = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
		const secondToken = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

		expect(hashSessionToken(firstToken)).not.toBe(hashSessionToken(secondToken));
	});

	it('rejects malformed cookie values before database lookup', () => {
		expect(isSessionToken('too-short')).toBe(false);
		expect(isSessionToken('!'.repeat(43))).toBe(false);
	});
});

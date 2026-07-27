import { describe, expect, it, vi } from 'vitest';
import { cleanupPreservingPrimaryFailure } from './cleanup';

describe('cleanup failure precedence', () => {
	it('preserves the primary exception while reporting cleanup separately', async () => {
		const primary = new Error('primary');
		const report = vi.fn();
		await expect(cleanupPreservingPrimaryFailure(
			primary,
			async () => { throw new Error('cleanup'); },
			report
		)).resolves.toBeUndefined();
		expect(report).toHaveBeenCalledOnce();
	});

	it('throws cleanup failure when no primary failure exists', async () => {
		await expect(cleanupPreservingPrimaryFailure(
			undefined,
			async () => { throw new Error('cleanup'); },
			vi.fn()
		)).rejects.toThrow('cleanup');
	});
});

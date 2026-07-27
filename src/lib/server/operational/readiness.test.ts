import { describe, expect, it, vi } from 'vitest';
import {
	checkApplicationReadiness,
	ReadinessError
} from './readiness';

describe('readiness behavior', () => {
	it('succeeds when all bounded dependencies are healthy', async () => {
		const verify = vi.fn().mockResolvedValue(undefined);
		await expect(checkApplicationReadiness({ verify, timeoutMs: 100 })).resolves.toBeUndefined();
		expect(verify).toHaveBeenCalledOnce();
	});

	it('reports MongoDB or filesystem dependency failures', async () => {
		await expect(checkApplicationReadiness({
			verify: vi.fn().mockRejectedValue(new Error('synthetic dependency failure')),
			timeoutMs: 100
		})).rejects.toThrow('synthetic dependency failure');
	});

	it('has a bounded timeout and clears its timer', async () => {
		await expect(checkApplicationReadiness({
			verify: () => new Promise<void>(() => undefined),
			timeoutMs: 10
		})).rejects.toMatchObject({
			name: 'ReadinessError',
			safeCode: 'readiness_timeout'
		});
	});

	it('preserves safe dependency failure classifications', async () => {
		await expect(checkApplicationReadiness({
			verify: vi.fn().mockRejectedValue(
				new ReadinessError('filesystem', 'readiness_storage_unavailable')
			),
			timeoutMs: 100
		})).rejects.toMatchObject({
			category: 'filesystem',
			safeCode: 'readiness_storage_unavailable'
		});
	});
});

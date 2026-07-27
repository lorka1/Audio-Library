import { describe, expect, it, vi } from 'vitest';
import { GracefulShutdown, type ShutdownResources } from './shutdown';

function resources(overrides: Partial<ShutdownResources> = {}): ShutdownResources {
	return {
		stopAccepting: vi.fn().mockResolvedValue(undefined),
		closeListeners: vi.fn().mockResolvedValue(undefined),
		closeSessions: vi.fn().mockResolvedValue(undefined),
		closeMongoClient: vi.fn().mockResolvedValue(undefined),
		closeRemaining: vi.fn().mockResolvedValue(undefined),
		forceClose: vi.fn().mockResolvedValue(undefined),
		...overrides
	};
}

describe('graceful shutdown', () => {
	it('runs the ordered sequence once for repeated shutdown calls', async () => {
		const owned = resources();
		const shutdown = new GracefulShutdown(owned);
		const first = shutdown.shutdown();
		const second = shutdown.shutdown();
		expect(first).toBe(second);
		await first;
		for (const operation of [
			owned.stopAccepting,
			owned.closeListeners,
			owned.closeSessions,
			owned.closeMongoClient,
			owned.closeRemaining
		]) expect(operation).toHaveBeenCalledTimes(1);
		expect(owned.forceClose).not.toHaveBeenCalled();
	});

	it('continues cleanup and reports independent cleanup failures', async () => {
		const owned = resources({
			closeSessions: vi.fn().mockRejectedValue(new Error('primary cleanup failure')),
			closeMongoClient: vi.fn().mockRejectedValue(new Error('secondary cleanup failure'))
		});
		const result = await new GracefulShutdown(owned).shutdown();
		expect(result.cleanupErrors).toHaveLength(2);
		expect(owned.closeRemaining).toHaveBeenCalledOnce();
	});

	it('forces bounded shutdown when in-flight work never completes', async () => {
		const owned = resources({
			stopAccepting: vi.fn(() => new Promise<void>(() => undefined))
		});
		const result = await new GracefulShutdown(owned, 10).shutdown();
		expect(result.forced).toBe(true);
		expect(owned.forceClose).toHaveBeenCalledOnce();
	});
});

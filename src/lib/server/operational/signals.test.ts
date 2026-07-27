import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { installShutdownSignalHandlers } from './signals';

describe('shutdown signal handlers', () => {
	it.each(['SIGINT', 'SIGTERM'] as const)('routes %s through graceful shutdown', async (signal) => {
		const events = new EventEmitter();
		const shutdown = vi.fn().mockResolvedValue(undefined);
		const dispose = installShutdownSignalHandlers(events, shutdown, vi.fn());
		events.emit(signal);
		await Promise.resolve();
		expect(shutdown).toHaveBeenCalledWith(signal);
		dispose();
	});

	it('catches shutdown rejection without an unhandled promise', async () => {
		const events = new EventEmitter();
		const report = vi.fn();
		installShutdownSignalHandlers(
			events,
			vi.fn().mockRejectedValue(new Error('synthetic shutdown failure')),
			report
		);
		events.emit('SIGTERM');
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(report).toHaveBeenCalledOnce();
	});
});

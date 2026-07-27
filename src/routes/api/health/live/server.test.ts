import { describe, expect, it } from 'vitest';
import { GET } from './+server';

describe('liveness endpoint', () => {
	it('returns only stable process health', async () => {
		const response = await GET({} as never);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'ok' });
	});
});

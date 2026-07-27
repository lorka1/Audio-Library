import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkApplicationReadiness } from '$lib/server/operational/readiness';
import { safeErrorFields, writeSafeLog } from '$lib/server/operational/logging';

export const GET: RequestHandler = async ({ locals }) => {
	try {
		await checkApplicationReadiness();
		return json({ status: 'ready' });
	} catch (error) {
		writeSafeLog({
			severity: 'warn',
			category: 'mongodb',
			...safeErrorFields(error),
			requestId: locals.requestId
		});
		return json({ status: 'unavailable' }, { status: 503 });
	}
};

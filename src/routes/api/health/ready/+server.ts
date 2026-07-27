import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	checkApplicationReadiness,
	ReadinessError
} from '$lib/server/operational/readiness';
import { safeErrorFields, writeSafeLog } from '$lib/server/operational/logging';

export const GET: RequestHandler = async ({ locals }) => {
	try {
		await checkApplicationReadiness();
		return json({ status: 'ready' });
	} catch (error) {
		writeSafeLog({
			severity: 'warn',
			category: error instanceof ReadinessError ? error.category : 'mongodb',
			...(error instanceof ReadinessError
				? { code: error.safeCode, errorType: error.name }
				: safeErrorFields(error)),
			requestId: locals.requestId
		});
		return json({ status: 'unavailable' }, { status: 503 });
	}
};

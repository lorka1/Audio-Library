import { safeErrorFields, writeSafeLog } from '../operational/logging';

export function logAuthError(_context: string, error: unknown): void {
	writeSafeLog({
		severity: 'error',
		category: 'authorization',
		...safeErrorFields(error)
	});
}

import { safeErrorFields, writeSafeLog } from '../operational/logging';

export function logTrackStorageError(_context: string, error: unknown): void {
	writeSafeLog({
		severity: 'error',
		category: 'filesystem',
		...safeErrorFields(error)
	});
}

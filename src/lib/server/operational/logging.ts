import { randomUUID } from 'node:crypto';

export type LogSeverity = 'warn' | 'error';
export type OperationCategory =
	| 'configuration'
	| 'mongodb'
	| 'filesystem'
	| 'request'
	| 'validation'
	| 'authorization'
	| 'shutdown';

export interface SafeLogEvent {
	severity: LogSeverity;
	category: OperationCategory;
	code: string;
	requestId?: string;
	method?: string;
	route?: string;
	status?: number;
	errorType?: string;
}

function sanitizedCode(error: unknown): string | undefined {
	if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
	const value = (error as { code?: unknown }).code;
	return typeof value === 'string' || typeof value === 'number'
		? String(value).slice(0, 64)
		: undefined;
}

export function safeErrorFields(error: unknown): Pick<SafeLogEvent, 'errorType' | 'code'> {
	return {
		errorType: error instanceof Error ? error.name : 'UnknownError',
		code: sanitizedCode(error) ?? 'operation_failed'
	};
}

export function writeSafeLog(event: SafeLogEvent): void {
	const record = JSON.stringify({
		timestamp: new Date().toISOString(),
		...event
	});
	if (event.severity === 'error') console.error(record);
	else console.warn(record);
}

export function createRequestId(): string {
	return randomUUID();
}

export function routeCategory(pathname: string): string {
	if (pathname.startsWith('/api/health/')) return 'health';
	if (pathname.startsWith('/api/tracks/')) return 'media';
	if (pathname.startsWith('/tracks')) return 'public_tracks';
	if (pathname.startsWith('/my-tracks')) return 'owner_tracks';
	if (pathname === '/upload') return 'upload';
	if (['/login', '/logout', '/register'].includes(pathname)) return 'authentication';
	if (pathname === '/account') return 'account';
	return 'application';
}

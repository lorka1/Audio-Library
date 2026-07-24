function readErrorCode(error: unknown): string | number | undefined {
	if (typeof error !== 'object' || error === null || !('code' in error)) {
		return undefined;
	}

	const code = (error as { code?: unknown }).code;
	return typeof code === 'string' || typeof code === 'number' ? code : undefined;
}

export function logTrackStorageError(context: string, error: unknown): void {
	const errorType = error instanceof Error ? error.name : 'UnknownError';
	const errorCode = readErrorCode(error);

	console.error(`[tracks] ${context}`, {
		errorType,
		...(errorCode === undefined ? {} : { errorCode })
	});
}

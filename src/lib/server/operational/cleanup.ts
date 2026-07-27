export async function cleanupPreservingPrimaryFailure(
	primaryFailure: unknown,
	cleanup: () => Promise<void>,
	reportCleanupFailure: (error: unknown) => void
): Promise<void> {
	try {
		await cleanup();
	} catch (cleanupError) {
		reportCleanupFailure(cleanupError);
		if (primaryFailure === undefined) throw cleanupError;
	}
}

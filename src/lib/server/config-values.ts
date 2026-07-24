export const DEFAULT_MAX_AUDIO_FILE_SIZE_MB = 50;

const BYTES_PER_MEBIBYTE = 1024 * 1024;

export interface AudioFileSizeLimit {
	megabytes: number;
	bytes: number;
}

export function parseAudioFileSizeLimit(
	value: string | undefined,
	fallbackMegabytes = DEFAULT_MAX_AUDIO_FILE_SIZE_MB
): AudioFileSizeLimit {
	const normalizedValue = value?.trim();
	const parsedMegabytes = normalizedValue ? Number(normalizedValue) : Number.NaN;
	const parsedBytes = Math.floor(parsedMegabytes * BYTES_PER_MEBIBYTE);

	if (
		!Number.isFinite(parsedMegabytes) ||
		parsedMegabytes <= 0 ||
		!Number.isSafeInteger(parsedBytes) ||
		parsedBytes < 1
	) {
		return {
			megabytes: fallbackMegabytes,
			bytes: Math.floor(fallbackMegabytes * BYTES_PER_MEBIBYTE)
		};
	}

	return {
		megabytes: parsedMegabytes,
		bytes: parsedBytes
	};
}

export const MAX_PUBLIC_TRACK_ID = 2_147_483_647;

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

export function parseTrackId(value: string): number | null {
	if (!POSITIVE_INTEGER_PATTERN.test(value)) {
		return null;
	}

	const id = Number(value);

	if (!Number.isSafeInteger(id) || id > MAX_PUBLIC_TRACK_ID) {
		return null;
	}

	return id;
}

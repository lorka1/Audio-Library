export type ByteRangeResult =
	| { kind: 'full' }
	| {
			kind: 'partial';
			start: number;
			end: number;
			length: number;
	  }
	| { kind: 'unsatisfiable' };

const BYTE_RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/i;

function parseRangeNumber(value: string): number | null {
	if (!/^\d+$/.test(value)) {
		return null;
	}

	const number = Number(value);
	return Number.isSafeInteger(number) ? number : null;
}

export function parseByteRange(
	rangeHeader: string | null,
	fileSize: number
): ByteRangeResult {
	if (rangeHeader === null) {
		return { kind: 'full' };
	}

	if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
		return { kind: 'unsatisfiable' };
	}

	const match = BYTE_RANGE_PATTERN.exec(rangeHeader);

	if (!match) {
		return { kind: 'unsatisfiable' };
	}

	const [, startText, endText] = match;

	if (!startText && !endText) {
		return { kind: 'unsatisfiable' };
	}

	if (fileSize === 0) {
		return { kind: 'unsatisfiable' };
	}

	if (!startText) {
		const suffixLength = parseRangeNumber(endText);

		if (suffixLength === null || suffixLength === 0) {
			return { kind: 'unsatisfiable' };
		}

		const length = Math.min(suffixLength, fileSize);
		return {
			kind: 'partial',
			start: fileSize - length,
			end: fileSize - 1,
			length
		};
	}

	const start = parseRangeNumber(startText);

	if (start === null || start >= fileSize) {
		return { kind: 'unsatisfiable' };
	}

	const requestedEnd = endText ? parseRangeNumber(endText) : fileSize - 1;

	if (requestedEnd === null || requestedEnd < start) {
		return { kind: 'unsatisfiable' };
	}

	const end = Math.min(requestedEnd, fileSize - 1);

	return {
		kind: 'partial',
		start,
		end,
		length: end - start + 1
	};
}

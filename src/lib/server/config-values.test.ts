import { describe, expect, it } from 'vitest';
import {
	DEFAULT_MAX_AUDIO_FILE_SIZE_MB,
	parseAudioFileSizeLimit
} from './config-values';

describe('parseAudioFileSizeLimit', () => {
	it.each([undefined, '', '   ', '0', '-1', 'not-a-number', 'Infinity', '1e100'])(
		'uses the safe default for an invalid value: %s',
		(value) => {
			expect(parseAudioFileSizeLimit(value)).toEqual({
				megabytes: DEFAULT_MAX_AUDIO_FILE_SIZE_MB,
				bytes: 50 * 1024 * 1024
			});
		}
	);

	it('accepts a finite positive value and converts it to bytes', () => {
		expect(parseAudioFileSizeLimit('12.5')).toEqual({
			megabytes: 12.5,
			bytes: 12.5 * 1024 * 1024
		});
	});
});

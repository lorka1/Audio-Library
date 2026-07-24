import { describe, expect, it } from 'vitest';
import { buildDownloadContentDisposition } from './download';

describe('buildDownloadContentDisposition', () => {
	it('includes an ASCII fallback and RFC-compatible UTF-8 value', () => {
		expect(buildDownloadContentDisposition('track.mp3')).toBe(
			`attachment; filename="track.mp3"; filename*=UTF-8''track.mp3`
		);
		expect(buildDownloadContentDisposition('party track.mp3')).toContain(
			`filename*=UTF-8''party%20track.mp3`
		);
	});

	it('encodes Croatian characters and transliterates the ASCII fallback', () => {
		const header = buildDownloadContentDisposition('Čćž šđ.mp3');

		expect(header).toContain('filename="Ccz sd.mp3"');
		expect(header).toContain(
			`filename*=UTF-8''%C4%8C%C4%87%C5%BE%20%C5%A1%C4%91.mp3`
		);
		expect(header).not.toContain('Č');
	});

	it.each([
		['quote"; injected=yes.mp3', 'quote_injected_yes.mp3'],
		['semi;colon.mp3', 'semi_colon.mp3'],
		['line\r\nX-Evil: yes.mp3', 'lineX-Evil_yes.mp3']
	])('keeps punctuation from injecting headers: %j', (filename, fallback) => {
		const header = buildDownloadContentDisposition(filename);

		expect(header).toContain(`filename="${fallback}"`);
		expect(header).not.toMatch(/[\r\n]/);
	});

	it.each([
		['../../secret.mp3', 'secret.mp3'],
		['..\\..\\windows track.wav', 'windows track.wav']
	])('uses only the leaf of a path-like filename: %j', (filename, leaf) => {
		const header = buildDownloadContentDisposition(filename);

		expect(header).toContain(`filename="${leaf}"`);
		expect(header).not.toContain('..');
	});

	it.each(['', '.', '..', '\r\n', '🔥'])(
		'uses a meaningful fallback for an unusable filename: %j',
		(filename) => {
			expect(buildDownloadContentDisposition(filename)).toContain(
				'filename="audio-download"'
			);
		}
	);
});

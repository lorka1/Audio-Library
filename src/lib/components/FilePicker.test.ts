import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import FilePicker from './FilePicker.svelte';

describe('FilePicker', () => {
	it('keeps the named file input while presenting an accessible compact picker', () => {
		const { body } = render(FilePicker, {
			props: {
				id: 'audioFile',
				name: 'audioFile',
				accept: 'audio/mpeg,.mp3',
				required: true,
				buttonLabel: 'Choose audio file',
				defaultFilename: 'No audio file selected',
				ariaDescribedBy: 'audio-file-help'
			}
		});

		expect(body).toContain('id="audioFile"');
		expect(body).toContain('name="audioFile"');
		expect(body).toContain('type="file"');
		expect(body).toContain('accept="audio/mpeg,.mp3"');
		expect(body).toContain('required');
		expect(body).toContain('for="audioFile"');
		expect(body).toContain('Choose audio file');
		expect(body).toContain('id="audioFile-filename"');
		expect(body).toContain('No audio file selected');
		expect(body).toContain('aria-live="polite"');
		expect(body).toContain('aria-describedby="audio-file-help audioFile-filename"');
	});
});

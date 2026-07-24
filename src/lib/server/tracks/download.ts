const DEFAULT_DOWNLOAD_FILENAME = 'audio-download';
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/g;
const COMBINING_MARK_PATTERN = /[\u0300-\u036f]/g;
const UNSAFE_ASCII_FILENAME_PATTERN = /[^A-Za-z0-9._ ()\[\]-]/g;

function filenameLeaf(filename: string): string {
	const withoutControls = filename.toWellFormed().replace(CONTROL_CHARACTER_PATTERN, '');
	const segments = withoutControls.split(/[\\/]/);
	return segments.at(-1)?.trim() ?? '';
}

function usableFilename(filename: string): string {
	const leaf = filenameLeaf(filename);
	return leaf && !/^\.+$/.test(leaf) ? leaf : DEFAULT_DOWNLOAD_FILENAME;
}

function asciiFallback(filename: string): string {
	const transliterated = filename
		.replaceAll('đ', 'd')
		.replaceAll('Đ', 'D')
		.normalize('NFKD')
		.replace(COMBINING_MARK_PATTERN, '');
	const sanitized = transliterated
		.replace(UNSAFE_ASCII_FILENAME_PATTERN, '_')
		.replace(/(?:_+\s*|\s+_+)/g, '_')
		.replace(/_+/g, '_')
		.replace(/^[ .]+|[ .]+$/g, '');

	return sanitized && /[A-Za-z0-9]/.test(sanitized) && !/^\.+$/.test(sanitized)
		? sanitized
		: DEFAULT_DOWNLOAD_FILENAME;
}

function encodeRfc5987Value(value: string): string {
	return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
		`%${character.charCodeAt(0).toString(16).toUpperCase()}`
	);
}

export function buildDownloadContentDisposition(originalFilename: string): string {
	const filename = usableFilename(originalFilename);
	const fallback = asciiFallback(filename);

	return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987Value(filename)}`;
}

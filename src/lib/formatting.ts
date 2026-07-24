const dateFormatter = new Intl.DateTimeFormat('en-US', {
	year: 'numeric',
	month: 'long',
	day: 'numeric',
	timeZone: 'UTC'
});

const fileSizeFormatter = new Intl.NumberFormat('en-US', {
	maximumFractionDigits: 1
});

export function formatDate(isoDate: string): string {
	return dateFormatter.format(new Date(isoDate));
}

export function formatFileSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) {
		return 'Not available';
	}

	if (bytes < 1024) {
		return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
	}

	const units = ['KB', 'MB', 'GB', 'TB'] as const;
	let value = bytes / 1024;
	let unitIndex = 0;

	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}

	return `${fileSizeFormatter.format(value)} ${units[unitIndex]}`;
}

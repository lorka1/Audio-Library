export const THEME_STORAGE_KEY = 'audio-library-theme';

export type Theme = 'dark' | 'light';

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;
type ThemeRoot = {
	dataset: { theme?: string };
	style: { colorScheme: string };
};

function browserStorage(): ThemeStorage | null {
	if (typeof window === 'undefined') return null;
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

function browserRoot(): ThemeRoot | null {
	return typeof document === 'undefined' ? null : document.documentElement;
}

export function isTheme(value: unknown): value is Theme {
	return value === 'dark' || value === 'light';
}

export function getOppositeTheme(theme: Theme): Theme {
	return theme === 'dark' ? 'light' : 'dark';
}

export function getThemeToggleLabel(theme: Theme): string {
	return theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}

export function readStoredTheme(storage: ThemeStorage | null = browserStorage()): Theme {
	try {
		const stored = storage?.getItem(THEME_STORAGE_KEY);
		return isTheme(stored) ? stored : 'dark';
	} catch {
		return 'dark';
	}
}

export function readAppliedTheme(root: ThemeRoot | null = browserRoot()): Theme {
	return isTheme(root?.dataset.theme) ? root.dataset.theme : 'dark';
}

export function applyTheme(theme: Theme, root: ThemeRoot | null = browserRoot()): Theme {
	if (root) {
		root.dataset.theme = theme;
		root.style.colorScheme = theme;
	}
	return theme;
}

export function initializeTheme(
	options: { storage?: ThemeStorage | null; root?: ThemeRoot | null } = {}
): Theme {
	const root = options.root === undefined ? browserRoot() : options.root;
	const applied = root?.dataset.theme;
	const theme = isTheme(applied)
		? applied
		: readStoredTheme(options.storage === undefined ? browserStorage() : options.storage);
	return applyTheme(theme, root);
}

export function toggleTheme(
	options: { storage?: ThemeStorage | null; root?: ThemeRoot | null } = {}
): Theme {
	const root = options.root === undefined ? browserRoot() : options.root;
	const storage = options.storage === undefined ? browserStorage() : options.storage;
	const next = getOppositeTheme(readAppliedTheme(root));
	applyTheme(next, root);
	try {
		storage?.setItem(THEME_STORAGE_KEY, next);
	} catch {
		// A blocked preference store must not prevent an in-page theme change.
	}
	return next;
}

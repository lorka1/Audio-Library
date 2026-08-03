import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
	THEME_STORAGE_KEY,
	applyTheme,
	getOppositeTheme,
	getThemeToggleLabel,
	initializeTheme,
	readStoredTheme,
	toggleTheme
} from './theme';

function root(theme?: string) {
	return {
		dataset: theme ? { theme } : {},
		style: { colorScheme: '' }
	};
}

function storage(value: string | null) {
	return {
		getItem: vi.fn(() => value),
		setItem: vi.fn()
	};
}

describe('persistent theme state', () => {
	it.each([
		[null, 'dark'],
		['dark', 'dark'],
		['light', 'light'],
		['sepia', 'dark']
	] as const)('maps stored value %s to %s', (stored, expected) => {
		expect(readStoredTheme(storage(stored))).toBe(expected);
	});

	it('falls back safely when localStorage is blocked', () => {
		const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: vi.fn() };
		expect(readStoredTheme(blocked)).toBe('dark');
		expect(initializeTheme({ storage: blocked, root: root() })).toBe('dark');
	});

	it('still changes the current page when persistence is blocked', () => {
		const blocked = {
			getItem: vi.fn(() => 'dark'),
			setItem: () => { throw new Error('blocked'); }
		};
		const target = root('dark');
		expect(toggleTheme({ storage: blocked, root: target })).toBe('light');
		expect(target.dataset.theme).toBe('light');
	});

	it.each(['dark', 'light'] as const)('applies %s to the root attribute and color scheme', (theme) => {
		const target = root();
		expect(applyTheme(theme, target)).toBe(theme);
		expect(target.dataset.theme).toBe(theme);
		expect(target.style.colorScheme).toBe(theme);
	});

	it.each([
		['dark', 'light', 'Switch to light mode'],
		['light', 'dark', 'Switch to dark mode']
	] as const)('toggles %s to %s and persists it', (current, expected, label) => {
		const target = root(current);
		const preference = storage(null);
		expect(getThemeToggleLabel(current)).toBe(label);
		expect(getOppositeTheme(current)).toBe(expected);
		expect(toggleTheme({ root: target, storage: preference })).toBe(expected);
		expect(target.dataset.theme).toBe(expected);
		expect(target.style.colorScheme).toBe(expected);
		expect(preference.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, expected);
	});

	it('uses the pre-hydration root theme before consulting storage', () => {
		const target = root('light');
		const preference = storage('dark');
		expect(initializeTheme({ root: target, storage: preference })).toBe('light');
		expect(preference.getItem).not.toHaveBeenCalled();
	});

	it('is safe when imported and initialized during SSR', () => {
		expect(initializeTheme({ root: null, storage: null })).toBe('dark');
		expect(() => applyTheme('light', null)).not.toThrow();
	});

	it('keeps the pre-hydration script small, local, and limited to explicit themes', () => {
		const html = readFileSync(resolve('src/app.html'), 'utf8');
		const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
		expect(script).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
		expect(script).toContain("saved === 'dark' || saved === 'light'");
		expect(script).toContain('document.documentElement.dataset.theme = theme');
		expect(script).toContain('document.documentElement.style.colorScheme = theme');
		expect(script).not.toMatch(/fetch|XMLHttpRequest|WebSocket|cookie/i);
		expect((script.match(/localStorage\./g) ?? [])).toHaveLength(1);
	});

	it('keeps both palettes semantic and retains reduced-motion protection', () => {
		const css = readFileSync(resolve('src/app.css'), 'utf8');
		expect(css).toContain(":root[data-theme='dark']");
		expect(css).toContain(":root[data-theme='light']");
		expect(css).toContain('--page-bg:');
		expect(css).toContain('--player-bg:');
		expect(css).toContain('--dialog-bg:');
		expect(css).toContain('--input-bg:');
		expect(css).toContain('--waveform-primary:');
		expect(css).toContain('@media (prefers-reduced-motion: reduce)');
	});

	it.each([
		'src/lib/components/GlobalAudioPlayer.svelte',
		'src/lib/components/TrackCard.svelte',
		'src/lib/components/PlaylistArtwork.svelte',
		'src/lib/components/AddToPlaylist.svelte',
		'src/routes/+page.svelte',
		'src/routes/tracks/+page.svelte'
	])('uses shared theme variables in %s', (file) => {
		expect(readFileSync(resolve(file), 'utf8')).toContain('var(--');
	});
});

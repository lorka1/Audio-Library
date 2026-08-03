<script lang="ts">
	import { onMount } from 'svelte';
	import {
		getThemeToggleLabel,
		initializeTheme,
		readAppliedTheme,
		toggleTheme,
		type Theme
	} from '$lib/theme';

	let theme = $state<Theme>(readAppliedTheme());

	onMount(() => {
		theme = initializeTheme();
	});

	function changeTheme(): void {
		theme = toggleTheme();
	}
</script>

<button
	class="theme-toggle"
	type="button"
	aria-label={getThemeToggleLabel(theme)}
	title={getThemeToggleLabel(theme)}
	onclick={changeTheme}
>
	<svg class="theme-toggle__moon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
		<path d="M20.4 15.3A8.2 8.2 0 0 1 8.7 3.6 8.7 8.7 0 1 0 20.4 15.3Z"></path>
	</svg>
	<svg class="theme-toggle__sun" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
		<circle cx="12" cy="12" r="3.6"></circle>
		<path d="M12 2v2.2M12 19.8V22M4.9 4.9l1.6 1.6m11 11 1.6 1.6M2 12h2.2M19.8 12H22M4.9 19.1l1.6-1.6m11-11 1.6-1.6"></path>
	</svg>
</button>

<style>
	.theme-toggle {
		display: inline-grid;
		place-items: center;
		flex: 0 0 auto;
		width: 2.75rem;
		height: 2.75rem;
		padding: 0;
		color: var(--header-control-text);
		border: 1px solid var(--header-control-border);
		border-radius: 999px;
		background: var(--header-control-bg);
		cursor: pointer;
		transition:
			color 150ms ease,
			border-color 150ms ease,
			background-color 150ms ease,
			box-shadow 150ms ease;
	}

	.theme-toggle:hover {
		color: var(--header-text);
		border-color: var(--accent-border);
		background: var(--accent-soft);
	}

	.theme-toggle:focus-visible {
		outline-color: var(--focus-ring);
	}

	svg {
		grid-area: 1 / 1;
		width: 1.15rem;
		height: 1.15rem;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.8;
	}

	.theme-toggle__sun,
	:global(:root[data-theme='light']) .theme-toggle__moon {
		display: none;
	}

	:global(:root[data-theme='light']) .theme-toggle__sun {
		display: block;
	}
</style>

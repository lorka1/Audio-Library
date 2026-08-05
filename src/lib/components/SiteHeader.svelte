<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import ProfileMenu from './ProfileMenu.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import type { NavigationUser } from '$lib/types';

	let { user }: { user: NavigationUser | null } = $props();

	let mobileOpen = $state(false);
	let header: HTMLElement;
	let mobileTrigger: HTMLButtonElement;

	function isRouteActive(href: string): boolean {
		try {
			return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
		} catch {
			// Component-only SSR tests do not provide SvelteKit's request context.
			return false;
		}
	}

	function closeMobileMenu(restoreFocus = false): void {
		if (!mobileOpen) return;
		mobileOpen = false;
		if (restoreFocus) mobileTrigger.focus();
	}

	onMount(() => {
		function handlePointerDown(event: PointerEvent): void {
			if (mobileOpen && !header.contains(event.target as Node)) {
				closeMobileMenu();
			}
		}

		function handleKeyDown(event: KeyboardEvent): void {
			if (event.key === 'Escape' && mobileOpen) {
				event.preventDefault();
				closeMobileMenu(true);
			}
		}

		document.addEventListener('pointerdown', handlePointerDown);
		document.addEventListener('keydown', handleKeyDown);

		return () => {
			document.removeEventListener('pointerdown', handlePointerDown);
			document.removeEventListener('keydown', handleKeyDown);
		};
	});
</script>

<header class="site-header" bind:this={header}>
	<div class="page-container site-header__inner">
		<a class="brand" href="/" aria-label="Audio Library — home page">
			<span class="brand__mark" aria-hidden="true">
				<span></span>
				<span></span>
				<span></span>
				<span></span>
				<span></span>
			</span>
			<span>Audio Library</span>
		</a>

		<div class="header-actions">
			<nav class="desktop-navigation" aria-label="Main navigation">
				<a
					class="nav-link"
					href="/tracks"
					aria-current={isRouteActive('/tracks') ? 'page' : undefined}>Browse</a
				>
				{#if user}
					<a
						class="nav-link"
						href="/upload"
						aria-current={isRouteActive('/upload') ? 'page' : undefined}>Upload</a
					>
					<a
						class="nav-link"
						href="/playlists"
						aria-current={isRouteActive('/playlists') ? 'page' : undefined}>Playlists</a
					>
					<ProfileMenu {user} menuId="desktop-profile-menu" />
				{:else}
					<a
						class="nav-link"
						href="/login"
						aria-current={isRouteActive('/login') ? 'page' : undefined}>Login</a
					>
					<a
						class="nav-link nav-link--primary"
						href="/register"
						aria-current={isRouteActive('/register') ? 'page' : undefined}>Register</a
					>
				{/if}
			</nav>

			<ThemeToggle />

			<div class="mobile-actions">
				<button
					bind:this={mobileTrigger}
					class="mobile-menu-trigger"
					type="button"
					aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
					aria-expanded={mobileOpen}
					aria-controls="mobile-navigation"
					onclick={() => (mobileOpen = !mobileOpen)}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
						{#if mobileOpen}
							<path d="M6.4 5 5 6.4l5.6 5.6L5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z"></path>
						{:else}
							<path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"></path>
						{/if}
					</svg>
				</button>
				{#if user}
					<ProfileMenu {user} menuId="mobile-profile-menu" />
				{/if}
			</div>
		</div>
	</div>

	<nav
		id="mobile-navigation"
		class="mobile-navigation"
		hidden={!mobileOpen}
		aria-label="Mobile navigation"
	>
		<div class="page-container mobile-navigation__inner">
			<a
				href="/tracks"
				aria-current={isRouteActive('/tracks') ? 'page' : undefined}
				onclick={() => closeMobileMenu()}>Browse</a
			>
			{#if user}
				<a
					href="/upload"
					aria-current={isRouteActive('/upload') ? 'page' : undefined}
					onclick={() => closeMobileMenu()}>Upload</a
				>
				<a
					href="/playlists"
					aria-current={isRouteActive('/playlists') ? 'page' : undefined}
					onclick={() => closeMobileMenu()}>Playlists</a
				>
			{:else}
				<a
					href="/login"
					aria-current={isRouteActive('/login') ? 'page' : undefined}
					onclick={() => closeMobileMenu()}>Login</a
				>
				<a
					class="mobile-navigation__primary"
					href="/register"
					aria-current={isRouteActive('/register') ? 'page' : undefined}
					onclick={() => closeMobileMenu()}>Register</a
				>
			{/if}
		</div>
	</nav>
</header>

<style>
	.site-header {
		position: sticky;
		z-index: 20;
		top: 0;
		width: 100%;
		isolation: isolate;
		color: var(--header-text);
		background: var(--header-bg);
		border-bottom: 1px solid var(--border);
		box-shadow: var(--shadow-header);
		backdrop-filter: blur(0.85rem);
	}

	.site-header__inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		min-height: 4.5rem;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.65rem;
		font-size: 1.04rem;
		font-weight: 780;
		text-decoration: none;
		letter-spacing: -0.02em;
	}

	.brand__mark {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.105rem;
		width: 2rem;
		height: 2rem;
		border-radius: 0.55rem;
		background: linear-gradient(145deg, var(--accent), var(--accent-burgundy));
		box-shadow: var(--shadow-accent);
	}

	.brand__mark span {
		display: block;
		width: 0.12rem;
		border-radius: 999px;
		background: white;
	}

	.brand__mark span:nth-child(1),
	.brand__mark span:nth-child(5) {
		height: 0.42rem;
	}

	.brand__mark span:nth-child(2),
	.brand__mark span:nth-child(4) {
		height: 0.55rem;
	}

	.brand__mark span:nth-child(3) {
		height: 1rem;
	}

	.desktop-navigation {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.45rem;
		margin-left: auto;
	}

	.header-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-left: auto;
	}

	.nav-link,
	.mobile-navigation a {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0.55rem 0.75rem;
		color: var(--header-text-muted);
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 680;
		text-decoration: none;
	}

	.nav-link:hover,
	.mobile-navigation a:hover {
		color: var(--header-text);
		background: var(--header-hover-bg);
	}

	.nav-link[aria-current='page'],
	.mobile-navigation a[aria-current='page'] {
		color: var(--accent-strong);
	}

	.nav-link[aria-current='page'] {
		background: transparent;
		box-shadow: inset 0 -2px var(--accent);
	}

	.mobile-navigation a[aria-current='page'] {
		background: var(--accent-soft);
	}

	.nav-link--primary,
	.mobile-navigation .mobile-navigation__primary {
		min-width: 6rem;
		justify-content: center;
		color: var(--on-accent);
		background: linear-gradient(135deg, var(--accent), var(--accent-burgundy));
		box-shadow: var(--shadow-accent-soft);
	}

	.nav-link--primary:hover,
	.mobile-navigation .mobile-navigation__primary:hover,
	.nav-link--primary[aria-current='page'],
	.mobile-navigation .mobile-navigation__primary[aria-current='page'] {
		color: var(--on-accent);
		background: linear-gradient(135deg, var(--accent-hover), var(--accent-burgundy));
	}

	.nav-link:focus-visible,
	.mobile-navigation a:focus-visible,
	.brand:focus-visible,
	.mobile-menu-trigger:focus-visible {
		outline-color: var(--focus-ring);
	}

	.mobile-actions,
	.mobile-navigation {
		display: none;
	}

	.mobile-menu-trigger {
		display: inline-grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		padding: 0;
		color: var(--header-control-text);
		border: 1px solid var(--header-control-border);
		border-radius: 0.65rem;
		background: var(--header-control-bg);
		cursor: pointer;
	}

	.mobile-menu-trigger svg {
		width: 1.2rem;
		height: 1.2rem;
		fill: currentColor;
	}

	.mobile-navigation[hidden] {
		display: none;
	}

	@media (max-width: 48rem) {
		.site-header__inner {
			min-height: 4.25rem;
		}

		.desktop-navigation {
			display: none;
		}

		.mobile-actions {
			display: flex;
			align-items: center;
			gap: 0.5rem;
			margin-left: auto;
		}

		.mobile-navigation {
			display: block;
			border-top: 1px solid var(--border);
			background: var(--header-mobile-bg);
		}

		.mobile-navigation__inner {
			display: flex;
			flex-wrap: wrap;
			gap: 0.25rem;
			padding-block: 0.5rem;
		}
	}

</style>

<script lang="ts">
	import { onMount } from 'svelte';
	import ProfileMenu from './ProfileMenu.svelte';
	import type { NavigationUser } from '$lib/types';

	let { user }: { user: NavigationUser | null } = $props();

	let mobileOpen = $state(false);
	let header: HTMLElement;
	let mobileTrigger: HTMLButtonElement;

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
			</span>
			<span>Audio Library</span>
		</a>

		<nav class="desktop-navigation" aria-label="Main navigation">
			<a class="nav-link" href="/tracks">Browse</a>
			{#if user}
				<a class="nav-link" href="/upload">Upload</a>
				<ProfileMenu {user} menuId="desktop-profile-menu" />
			{:else}
				<a class="nav-link" href="/login">Login</a>
				<a class="nav-link" href="/register">Register</a>
			{/if}
		</nav>

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

	<nav
		id="mobile-navigation"
		class="mobile-navigation"
		hidden={!mobileOpen}
		aria-label="Mobile navigation"
	>
		<div class="page-container mobile-navigation__inner">
			<a href="/tracks" onclick={() => closeMobileMenu()}>Browse</a>
			{#if user}
				<a href="/upload" onclick={() => closeMobileMenu()}>Upload</a>
			{:else}
				<a href="/login" onclick={() => closeMobileMenu()}>Login</a>
				<a href="/register" onclick={() => closeMobileMenu()}>Register</a>
			{/if}
		</div>
	</nav>
</header>

<style>
	.site-header {
		position: sticky;
		z-index: 20;
		top: 0;
		color: #f9fafb;
		background: rgb(17 24 39 / 96%);
		border-bottom: 1px solid rgb(255 255 255 / 10%);
		backdrop-filter: blur(0.75rem);
	}

	.site-header__inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		min-height: 4.25rem;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.65rem;
		font-weight: 750;
		text-decoration: none;
		letter-spacing: -0.02em;
	}

	.brand__mark {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.125rem;
		width: 2rem;
		height: 2rem;
		border-radius: 0.55rem;
		background: linear-gradient(145deg, #756af1, #4d40d7);
		box-shadow: 0 0.5rem 1.5rem rgb(24 16 96 / 35%);
	}

	.brand__mark span {
		display: block;
		width: 0.15rem;
		border-radius: 999px;
		background: white;
	}

	.brand__mark span:nth-child(1),
	.brand__mark span:nth-child(3) {
		height: 0.55rem;
	}

	.brand__mark span:nth-child(2) {
		height: 1rem;
	}

	.desktop-navigation {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.25rem;
		margin-left: auto;
	}

	.nav-link,
	.mobile-navigation a {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0.55rem 0.75rem;
		color: #cbd5e1;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 650;
		text-decoration: none;
	}

	.nav-link:hover,
	.mobile-navigation a:hover {
		color: white;
		background: rgb(255 255 255 / 8%);
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
		color: #dbe3ef;
		border: 1px solid rgb(255 255 255 / 14%);
		border-radius: 0.65rem;
		background: rgb(255 255 255 / 6%);
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
			min-height: 4rem;
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
			border-top: 1px solid rgb(255 255 255 / 9%);
		}

		.mobile-navigation__inner {
			display: flex;
			gap: 0.25rem;
			padding-block: 0.5rem;
		}
	}

</style>

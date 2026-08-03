<script lang="ts">
	import { page } from '$app/state';
	import { onMount, tick } from 'svelte';
	import type { NavigationUser } from '$lib/types';

	let {
		user,
		menuId
	}: { user: NavigationUser; menuId: string } = $props();

	let open = $state(false);
	let container: HTMLDivElement;
	let trigger: HTMLButtonElement;
	let firstLink: HTMLAnchorElement;

	function isRouteActive(href: string, includeChildren = false): boolean {
		try {
			return includeChildren
				? page.url.pathname === href || page.url.pathname.startsWith(`${href}/`)
				: page.url.pathname === href;
		} catch {
			// Component-only SSR tests do not provide SvelteKit's request context.
			return false;
		}
	}

	async function toggleMenu(): Promise<void> {
		open = !open;

		if (open) {
			await tick();
			firstLink.focus();
		}
	}

	function closeMenu(restoreFocus = false): void {
		if (!open) return;
		open = false;
		if (restoreFocus) trigger.focus();
	}

	onMount(() => {
		function handlePointerDown(event: PointerEvent): void {
			if (open && !container.contains(event.target as Node)) {
				closeMenu();
			}
		}

		function handleKeyDown(event: KeyboardEvent): void {
			if (event.key === 'Escape' && open) {
				event.preventDefault();
				closeMenu(true);
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

<div class="profile-menu" bind:this={container}>
	<button
		bind:this={trigger}
		class="profile-menu__trigger"
		type="button"
		aria-label={open ? 'Close profile menu' : 'Open profile menu'}
		aria-expanded={open}
		aria-controls={menuId}
		onclick={toggleMenu}
	>
		<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
			<path
				d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-5 0-9 2.5-9 5.5V22h18v-2.5C21 16.5 17 14 12 14Z"
			></path>
		</svg>
	</button>

	<div
		id={menuId}
		class="profile-menu__panel"
		hidden={!open}
		aria-label="Profile navigation"
	>
		<p>Signed in as <strong>{user.username}</strong></p>
		<a
			bind:this={firstLink}
			href="/my-tracks"
			aria-current={isRouteActive('/my-tracks', true) ? 'page' : undefined}
			onclick={() => closeMenu()}>My Tracks</a
		>
		<a
			href="/playlists"
			aria-current={isRouteActive('/playlists', true) ? 'page' : undefined}
			onclick={() => closeMenu()}>Playlists</a
		>
		<a
			href="/account"
			aria-current={isRouteActive('/account') ? 'page' : undefined}
			onclick={() => closeMenu()}>Account</a
		>
		<form method="POST" action="/logout">
			<button type="submit">Logout</button>
		</form>
	</div>
</div>

<style>
	.profile-menu {
		position: relative;
	}

	.profile-menu__trigger {
		display: inline-grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		padding: 0;
		color: #d8deec;
		border: 1px solid rgb(159 171 209 / 20%);
		border-radius: 999px;
		background: rgb(255 255 255 / 6%);
		cursor: pointer;
	}

	.profile-menu__trigger:hover,
	.profile-menu__trigger[aria-expanded='true'] {
		color: white;
		border-color: rgb(151 126 255 / 42%);
		background: rgb(104 71 245 / 18%);
	}

	.profile-menu__trigger svg {
		width: 1.2rem;
		height: 1.2rem;
		fill: currentColor;
	}

	.profile-menu__panel {
		position: absolute;
		z-index: 50;
		top: calc(100% + 0.65rem);
		right: 0;
		width: min(17rem, calc(100vw - 2rem));
		padding: 0.5rem;
		color: var(--text);
		border: 1px solid rgb(145 158 200 / 23%);
		border-radius: 0.8rem;
		background: #10172b;
		box-shadow: 0 1.25rem 3rem rgb(0 2 14 / 48%);
	}

	.profile-menu__panel[hidden] {
		display: none;
	}

	.profile-menu__panel p {
		margin: 0;
		padding: 0.75rem;
		color: var(--text-muted);
		border-bottom: 1px solid var(--border);
		font-size: 0.78rem;
		overflow-wrap: anywhere;
	}

	.profile-menu__panel strong {
		display: block;
		margin-top: 0.15rem;
		color: var(--text);
		font-size: 0.9rem;
	}

	.profile-menu__panel a,
	.profile-menu__panel form button {
		display: flex;
		width: 100%;
		align-items: center;
		min-height: 2.75rem;
		padding: 0.65rem 0.75rem;
		color: var(--text);
		border: 0;
		border-radius: 0.5rem;
		background: transparent;
		font-size: 0.875rem;
		font-weight: 700;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
	}

	.profile-menu__panel a:hover,
	.profile-menu__panel form button:hover {
		background: var(--surface-muted);
	}

	.profile-menu__panel a[aria-current='page'] {
		color: #b4a5ff;
		background: var(--accent-soft);
	}

	.profile-menu__panel form {
		margin: 0;
		border-top: 1px solid var(--border);
	}
</style>

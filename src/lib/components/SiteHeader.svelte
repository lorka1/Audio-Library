<script lang="ts">
	import type { NavigationItem } from '$lib/types';

	const navigation: NavigationItem[] = [
		{ label: 'Home', href: '/' },
		{ label: 'Project foundation', href: '/#foundation' }
	];
</script>

<header class="site-header">
	<div class="page-container site-header__inner">
		<a class="brand" href="/" aria-label="Audio Library — home page">
			<span class="brand__mark" aria-hidden="true">
				<span></span>
				<span></span>
				<span></span>
			</span>
			<span>Audio Library</span>
		</a>

		<nav aria-label="Main navigation">
			<ul>
				{#each navigation as item}
					<li><a href={item.href}>{item.label}</a></li>
				{/each}
			</ul>
		</nav>
	</div>
</header>

<style>
	.site-header {
		position: sticky;
		z-index: 10;
		top: 0;
		color: #f9fafb;
		background: rgb(17 24 39 / 95%);
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

	ul {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	nav a {
		display: inline-flex;
		padding: 0.55rem 0.7rem;
		color: #cbd5e1;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 600;
		text-decoration: none;
		transition:
			color 150ms ease,
			background-color 150ms ease;
	}

	nav a:hover {
		color: white;
		background: rgb(255 255 255 / 8%);
	}

	@media (max-width: 34rem) {
		nav li:last-child {
			display: none;
		}
	}
</style>

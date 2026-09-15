<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const statistics = $derived([
		{ label: 'Registered users', value: data.stats.totalUsers },
		{ label: 'Audio tracks', value: data.stats.totalTracks },
		{ label: 'Public tracks', value: data.stats.publicTracks },
		{ label: 'Private tracks', value: data.stats.privateTracks },
		{ label: 'Playlists', value: data.stats.totalPlaylists }
	]);
</script>

<svelte:head>
	<title>Admin Dashboard · Audio Library</title>
	<meta name="description" content="Administrator overview for Audio Library." />
</svelte:head>

<section class="admin-page">
	<div class="page-container admin-page__inner">
		<header class="admin-heading">
			<p class="auth-eyebrow">Administrator area</p>
			<h1>Admin Dashboard</h1>
			<p>Review account and library totals, then open a focused management area.</p>
		</header>

		<div class="statistics-grid" aria-label="Application statistics">
			{#each statistics as statistic (statistic.label)}
				<article class="statistic-card">
					<strong>{statistic.value}</strong>
					<span>{statistic.label}</span>
				</article>
			{/each}
		</div>

		<div class="admin-destinations">
			<a href="/admin/users">
				<span>Accounts</span>
				<strong>Manage users</strong>
				<p>View safe account details, roles, registration dates, and upload totals.</p>
			</a>
			<a href="/admin/tracks">
				<span>Moderation</span>
				<strong>Manage tracks</strong>
				<p>Review public and private tracks and remove content with complete cleanup.</p>
			</a>
		</div>
	</div>
</section>

<style>
	.admin-page {
		padding-block: clamp(3rem, 8vw, 6rem);
	}

	.admin-page__inner {
		max-width: 78rem;
	}

	.admin-heading {
		max-width: 48rem;
		margin-bottom: 2rem;
	}

	.admin-heading h1 {
		margin: 0;
		font-size: clamp(2.4rem, 7vw, 4.2rem);
		line-height: 1;
		letter-spacing: -0.05em;
	}

	.admin-heading p:last-child {
		margin: 1rem 0 0;
		color: var(--text-muted);
		line-height: 1.65;
	}

	.statistics-grid {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 0.8rem;
	}

	.statistic-card {
		display: grid;
		gap: 0.45rem;
		min-width: 0;
		padding: 1.25rem;
		border: 1px solid var(--border);
		border-radius: 0.9rem;
		background: var(--card-background);
		box-shadow: var(--shadow-card);
	}

	.statistic-card strong {
		color: var(--accent-strong);
		font-size: clamp(1.8rem, 5vw, 2.5rem);
		line-height: 1;
	}

	.statistic-card span {
		color: var(--text-muted);
		font-size: 0.82rem;
		font-weight: 750;
	}

	.admin-destinations {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
		margin-top: 1.5rem;
	}

	.admin-destinations a {
		display: grid;
		gap: 0.5rem;
		padding: clamp(1.25rem, 4vw, 2rem);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: var(--surface);
		box-shadow: var(--shadow-card);
		text-decoration: none;
	}

	.admin-destinations a:hover {
		border-color: var(--accent-border);
		background: var(--card-background-hover);
	}

	.admin-destinations span {
		color: var(--accent-strong);
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.admin-destinations strong {
		font-size: 1.35rem;
	}

	.admin-destinations p {
		margin: 0;
		color: var(--text-muted);
		line-height: 1.55;
	}

	@media (max-width: 64rem) {
		.statistics-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	@media (max-width: 42rem) {
		.statistics-grid,
		.admin-destinations {
			grid-template-columns: 1fr;
		}
	}
</style>

<script lang="ts">
	import { TrackCard, TrackFilters } from '$lib';
	import { formatTrackResultCount } from '$lib/tracks-query';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Search public tracks · Audio Library</title>
	<meta
		name="description"
		content="Search, filter, and sort public audio tracks shared by Audio Library members."
	/>
</svelte:head>

<section class="tracks-page">
	<header class="tracks-hero">
		<div class="page-container tracks-hero__inner">
			<div class="tracks-heading">
				<p class="auth-eyebrow">Your audio, ready to share</p>
				<h1>Find the perfect track<span>.</span></h1>
			</div>
			<p class="tracks-intro">
				Search the community-powered library by title, artist, or description, then
				refine public tracks by BPM, musical key, genre, and sort order.
			</p>
		</div>
	</header>

	<div class="page-container tracks-content">
		{#if data.playlistNotice}
			<div
				class="form-message"
				class:form-message--success={data.playlistNotice.kind === 'success'}
				class:form-message--error={data.playlistNotice.kind === 'error'}
				role="status"
			>
				{data.playlistNotice.message}
			</div>
		{/if}
		<TrackFilters values={data.filterValues} errors={data.filterErrors} />

		<div class="track-results">
			<p class="track-results__count">{formatTrackResultCount(data.tracks.length)}</p>

			{#if data.activeFilterSummary.length > 0}
				<div class="active-filters" aria-label="Active filters">
					<span>Active:</span>
					<ul>
						{#each data.activeFilterSummary as filter}
							<li>{filter}</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>

		{#if data.tracks.length > 0}
			<div class="track-grid">
				{#each data.tracks as track (track.id)}
					<TrackCard
						{track}
						playlistChoices={data.playlistChoices?.[String(track.id)] ?? null}
						loginHref={data.loginHref}
					/>
				{/each}
			</div>
		{:else}
			<div class="tracks-empty">
				<p>
					{data.hasActiveFilters
						? 'No public tracks match the selected search and filters.'
						: 'No public tracks have been uploaded yet.'}
				</p>
				{#if data.hasActiveFilters}
					<a class="secondary-button tracks-empty__action" href="/tracks">Clear filters</a>
				{/if}
			</div>
		{/if}
	</div>
</section>

<style>
	.track-results {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem 2rem;
		margin: 0.5rem 0 1.1rem;
	}

	.tracks-hero {
		position: relative;
		min-height: 18rem;
		padding-block: clamp(3.75rem, 7vw, 5rem) 7rem;
		overflow: hidden;
		background: var(--hero-background);
	}

	.tracks-hero::after {
		position: absolute;
		top: 24%;
		right: 8%;
		width: 0.38rem;
		height: 0.38rem;
		content: '';
		border-radius: 999px;
		background: var(--hero-dot);
		box-shadow: 2.25rem 1.4rem 0 color-mix(in srgb, var(--accent-plum) 28%, transparent);
	}

	.tracks-hero__inner {
		display: grid;
		grid-template-columns: minmax(0, 1.25fr) minmax(18rem, 0.75fr);
		align-items: end;
		gap: clamp(2rem, 6vw, 6rem);
	}

	.tracks-heading {
		position: relative;
		z-index: 1;
		max-width: 43rem;
		margin: 0;
	}

	.tracks-heading h1 {
		margin: 0;
		color: var(--hero-text);
		font-size: clamp(2.75rem, 5vw, 4.75rem);
		line-height: 1;
		letter-spacing: -0.052em;
		text-wrap: balance;
	}

	.tracks-heading h1 span {
		color: var(--accent-strong);
	}

	.tracks-intro {
		position: relative;
		z-index: 1;
		max-width: 39rem;
		margin: 0 0 0.35rem;
		color: var(--hero-muted);
		font-size: clamp(0.98rem, 1.5vw, 1.12rem);
		line-height: 1.65;
	}

	.tracks-content {
		position: relative;
		z-index: 2;
		margin-top: -4.75rem;
	}

	.track-results__count {
		flex: 0 0 auto;
		margin: 0;
		color: var(--text);
		font-weight: 800;
		letter-spacing: -0.015em;
	}

	.active-filters {
		display: flex;
		align-items: baseline;
		justify-content: flex-end;
		gap: 0.5rem;
		color: var(--text-muted);
		font-size: 0.84rem;
		text-align: right;
	}

	.active-filters > span {
		color: var(--text);
		font-weight: 750;
	}

	.active-filters ul {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.active-filters li {
		padding: 0.28rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		overflow-wrap: anywhere;
	}

	.tracks-empty__action {
		margin-top: 1rem;
	}

	@media (max-width: 42rem) {
		.track-results,
		.active-filters {
			align-items: flex-start;
			flex-direction: column;
		}

		.active-filters,
		.active-filters ul {
			justify-content: flex-start;
			text-align: left;
		}
	}

	@media (max-width: 62rem) {
		.tracks-hero__inner {
			grid-template-columns: minmax(0, 1fr);
			gap: 1.25rem;
		}

		.tracks-intro {
			margin: 0;
		}
	}

	@media (max-width: 43.75rem) {
		.tracks-hero {
			min-height: 17rem;
			padding-block: 3.5rem 6rem;
		}

		.tracks-heading h1 {
			font-size: clamp(2.65rem, 13vw, 4rem);
		}

		.tracks-content {
			margin-top: -3.75rem;
		}
	}
</style>

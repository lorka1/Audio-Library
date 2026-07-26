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
	<div class="page-container">
		<header class="tracks-heading">
			<p class="auth-eyebrow">Public audio library</p>
			<h1>Browse tracks</h1>
			<p>
				Search by title, artist, or description, then refine public tracks by BPM,
				musical key, genre, and sort order.
			</p>
		</header>

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
					<TrackCard {track} />
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
		margin-bottom: 1rem;
	}

	.track-results__count {
		flex: 0 0 auto;
		margin: 0;
		color: var(--text);
		font-weight: 800;
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
</style>

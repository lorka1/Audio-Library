<script lang="ts">
	import { AudioWaveform, TrackCard, TrackFilters } from '$lib';
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
				<p>
					Search the community-powered library by title, artist, or description, then
					refine public tracks by BPM, musical key, genre, and sort order.
				</p>
			</div>
			<AudioWaveform variant="compact" class="tracks-hero__waveform" />
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
		min-height: 20rem;
		padding-block: clamp(3.5rem, 7vw, 5.75rem) 7rem;
		overflow: hidden;
		background:
			radial-gradient(circle at 76% 42%, rgb(98 37 207 / 18%), transparent 25rem),
			radial-gradient(circle at 17% 26%, rgb(36 60 139 / 18%), transparent 24rem),
			linear-gradient(112deg, #080d1f 0%, #0b1026 55%, #100824 100%);
	}

	.tracks-hero__inner {
		display: grid;
		grid-template-columns: minmax(0, 0.95fr) minmax(24rem, 1.05fr);
		align-items: center;
		gap: 2rem;
	}

	.tracks-heading {
		position: relative;
		z-index: 1;
		max-width: 43rem;
		margin: 0;
	}

	.tracks-heading h1 {
		margin: 0;
		color: white;
		font-size: clamp(2.75rem, 5vw, 4.75rem);
		line-height: 1;
		letter-spacing: -0.052em;
		text-wrap: balance;
	}

	.tracks-heading h1 span {
		color: #795cff;
	}

	.tracks-heading > p:last-child {
		max-width: 39rem;
		margin: 1rem 0 0;
		color: #b7bfd2;
		font-size: clamp(0.98rem, 1.5vw, 1.12rem);
		line-height: 1.65;
	}

	:global(.tracks-hero__waveform) {
		width: min(43rem, 47vw);
		margin-right: -7rem;
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
		}

		:global(.tracks-hero__waveform) {
			position: absolute;
			right: -13rem;
			bottom: -7rem;
			width: 42rem;
			margin: 0;
			opacity: 0.34;
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

<script lang="ts">
	import { OwnerTrackCard } from '$lib';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>My Tracks · Audio Library</title>
	<meta
		name="description"
		content="Manage the metadata and deletion of audio tracks you own."
	/>
</svelte:head>

<section class="management-page">
	<div class="page-container">
		<header class="management-heading">
			<div>
				<p class="auth-eyebrow">Owner-only library</p>
				<h1>My Tracks</h1>
				<p>
					Manage metadata or remove tracks you uploaded. Public and private tracks both
					appear here.
				</p>
			</div>
			<a class="primary-button" href="/upload">Upload another track</a>
		</header>

		{#if data.updated}
			<div class="form-message form-message--success" role="status">
				Track metadata updated successfully.
			</div>
		{/if}

		{#if data.deleted}
			<div class="form-message form-message--success" role="status">
				Track deleted successfully.
			</div>
		{/if}

		<p class="management-count">
			{data.tracks.length} {data.tracks.length === 1 ? 'owned track' : 'owned tracks'}
		</p>

		{#if data.tracks.length > 0}
			<div class="owner-track-grid">
				{#each data.tracks as track (track.publicId)}
					<OwnerTrackCard {track} />
				{/each}
			</div>
		{:else}
			<div class="tracks-empty owner-tracks-empty">
				<p>You have not uploaded any tracks yet.</p>
				<a class="primary-button" href="/upload">Upload your first track</a>
			</div>
		{/if}
	</div>
</section>

<style>
	.management-heading {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1.5rem;
		margin-bottom: 2rem;
	}

	.management-heading > div {
		max-width: 46rem;
	}

	.management-heading h1 {
		margin: 0;
		font-size: clamp(2.25rem, 7vw, 4rem);
		line-height: 1;
		letter-spacing: -0.05em;
	}

	.management-heading p:last-child {
		margin: 1rem 0 0;
		color: var(--text-muted);
		line-height: 1.65;
	}

	.management-heading > .primary-button {
		flex: 0 0 auto;
	}

	.management-count {
		margin: 0 0 1rem;
		font-weight: 800;
	}

	.owner-track-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
	}

	.owner-tracks-empty {
		display: grid;
		justify-items: center;
		gap: 1rem;
	}

	@media (max-width: 58rem) {
		.management-heading {
			align-items: flex-start;
			flex-direction: column;
		}

		.owner-track-grid {
			grid-template-columns: 1fr;
		}
	}
</style>

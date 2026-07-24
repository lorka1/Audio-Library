<script lang="ts">
	import { TrackCard } from '$lib';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Browse tracks · Audio Library</title>
	<meta
		name="description"
		content="Browse public audio tracks shared by Audio Library members."
	/>
</svelte:head>

<section class="tracks-page">
	<div class="page-container">
		<header class="tracks-heading">
			<p class="auth-eyebrow">Public audio library</p>
			<h1>Browse tracks</h1>
			<p>Discover public tracks uploaded by the Audio Library community.</p>
		</header>

		{#if data.tracks.length > 0}
			<div class="track-grid">
				{#each data.tracks as track (track.id)}
					<TrackCard {track} />
				{/each}
			</div>
		{:else}
			<div class="tracks-empty">
				<p>No public tracks have been uploaded yet.</p>
			</div>
		{/if}
	</div>
</section>

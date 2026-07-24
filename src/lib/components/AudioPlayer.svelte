<script lang="ts">
	let { trackId, title }: { trackId: number; title: string } = $props();
</script>

<div class="audio-player">
	<audio controls preload="metadata" aria-label={`Audio player for ${title}`}>
		<source src={`/api/tracks/${trackId}/stream`} />
		Your browser does not support the audio element.
		<a href={`/api/tracks/${trackId}/stream`}>Open the audio file</a>.
	</audio>
</div>

<style>
	.audio-player {
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: 0.85rem;
		background: var(--surface-muted);
	}

	audio {
		display: block;
		width: 100%;
	}
</style>

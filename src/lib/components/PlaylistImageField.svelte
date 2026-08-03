<script lang="ts">
	import PlaylistArtwork from './PlaylistArtwork.svelte';
	let { id = 'playlist-image', maxSizeMb, currentImageUrl = null, error, removeRequested = false, allowRemoval = false, playlistName = 'Playlist' }:
		{ id?: string; maxSizeMb: number; currentImageUrl?: string | null; error?: string; removeRequested?: boolean; allowRemoval?: boolean; playlistName?: string } = $props();
</script>

<div class="playlist-image-field">
	<PlaylistArtwork imageUrl={removeRequested ? null : currentImageUrl} name={playlistName} variant="card" decorative={false} />
	<div>
		<label for={id}>Playlist image <span class="optional-label">Optional</span></label>
		<input class="file-input" {id} name="image" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" aria-invalid={error ? 'true' : undefined} aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`} />
		<p class="field-help" id={`${id}-help`}>JPEG, PNG, or WebP, up to {maxSizeMb} MB. Image contents are verified by the server.</p>
		{#if error}<p class="field-error" id={`${id}-error`}>{error}</p>{/if}
		{#if allowRemoval && currentImageUrl}
			<label class="remove-image"><input name="removeImage" type="checkbox" value="true" checked={removeRequested} /> Remove the current playlist image</label>
		{/if}
	</div>
</div>

<style>
	.playlist-image-field { display: grid; grid-template-columns: 4.5rem minmax(0, 1fr); gap: 1rem; align-items: start; padding: 0.9rem; border: 1px solid var(--border); border-radius: 0.9rem; background: var(--surface-translucent); }
	.playlist-image-field :global(.playlist-artwork) { width: 4.5rem; }
	.playlist-image-field label:first-child { display: inline-block; margin-bottom: 0.45rem; }
	.remove-image { display: flex; align-items: center; gap: 0.55rem; margin-top: 0.75rem; color: var(--text-muted); font-size: 0.85rem; }
	.remove-image input { accent-color: var(--accent); }
</style>

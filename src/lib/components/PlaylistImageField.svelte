<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import FilePicker from './FilePicker.svelte';
	import PlaylistArtwork from './PlaylistArtwork.svelte';
	let { id = 'playlist-image', maxSizeMb, currentImageUrl = null, error, removeRequested = false, allowRemoval = false, playlistName = 'Playlist' }:
		{ id?: string; maxSizeMb: number; currentImageUrl?: string | null; error?: string; removeRequested?: boolean; allowRemoval?: boolean; playlistName?: string } = $props();

	let previewUrl = $state<string | null>(null);
	let selectedFilename = $state('');
	let removalChecked = $state(untrack(() => removeRequested));

	$effect(() => {
		removalChecked = removeRequested;
	});

	const helpId = $derived(`${id}-help`);
	const errorId = $derived(`${id}-error`);
	const describedBy = $derived([helpId, error ? errorId : null].filter(Boolean).join(' '));
	const displayedImageUrl = $derived(removalChecked ? null : (previewUrl ?? currentImageUrl));

	function isPreviewableImage(file: File): boolean {
		if (!file.name.trim() || file.name.length > 255 || file.name.includes('\0')) return false;
		if (!Number.isSafeInteger(file.size) || file.size === 0 || file.size > Math.floor(maxSizeMb * 1024 * 1024)) return false;
		const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
		const mimeType = file.type.trim().toLowerCase();
		return (
			((extension === '.jpg' || extension === '.jpeg') && mimeType === 'image/jpeg') ||
			(extension === '.png' && mimeType === 'image/png') ||
			(extension === '.webp' && mimeType === 'image/webp')
		);
	}

	function revokePreview(): void {
		if (previewUrl) {
			URL.revokeObjectURL(previewUrl);
			previewUrl = null;
		}
	}

	function handleFileChange(event: Event): void {
		revokePreview();
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		selectedFilename = file?.name ?? '';
		if (file) removalChecked = false;
		if (file && isPreviewableImage(file)) previewUrl = URL.createObjectURL(file);
	}

	function handleImageError(url: string): void {
		if (url === previewUrl) revokePreview();
	}

	onDestroy(revokePreview);
</script>

<div class="playlist-image-field">
	<PlaylistArtwork imageUrl={displayedImageUrl} name={playlistName} variant="card" decorative={false} onImageError={handleImageError} />
	<div class="playlist-image-field__control">
		<label class="playlist-image-field__label" for={id}>Playlist image <span class="optional-label">Optional</span></label>
		<FilePicker
			{id}
			name="image"
			accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
			buttonLabel="Choose image"
			emptyLabel="No image chosen"
			ariaInvalid={error ? 'true' : undefined}
			ariaDescribedBy={describedBy}
			onchange={handleFileChange}
		/>
		<p class="field-help" id={helpId}>JPEG, PNG, or WebP, up to {maxSizeMb} MB. Image contents are verified by the server.</p>
		{#if error}<p class="field-error" id={errorId}>{error}</p>{/if}
		{#if allowRemoval && currentImageUrl}
			<label class="remove-image"><input name="removeImage" type="checkbox" value="true" bind:checked={removalChecked} disabled={Boolean(selectedFilename)} /> Remove the current playlist image</label>
		{/if}
	</div>
</div>

<style>
	.playlist-image-field { display: grid; grid-template-columns: 4.5rem minmax(0, 1fr); gap: 1rem; align-items: start; padding: 0.9rem; border: 1px solid var(--border); border-radius: 0.9rem; background: var(--surface-translucent); }
	.playlist-image-field :global(.playlist-artwork) { width: 4.5rem; }
	.playlist-image-field__control { min-width: 0; }
	.playlist-image-field__label { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; width: fit-content; max-width: 100%; margin-bottom: 0.45rem; }
	.playlist-image-field .field-help, .playlist-image-field .field-error { overflow-wrap: anywhere; }
	.remove-image { display: flex; align-items: center; gap: 0.55rem; margin-top: 0.75rem; color: var(--text-muted); font-size: 0.85rem; }
	.remove-image input { accent-color: var(--accent); }
	@media (max-width: 24rem) {
		.playlist-image-field { grid-template-columns: 3.75rem minmax(0, 1fr); gap: 0.75rem; padding: 0.75rem; }
		.playlist-image-field :global(.playlist-artwork) { width: 3.75rem; }
	}
</style>

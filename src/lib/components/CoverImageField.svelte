<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import TrackCover from './TrackCover.svelte';

	let {
		id = 'coverImage',
		maxSizeMb,
		currentCoverImageUrl = null,
		error,
		needsReselection = false,
		removeCoverImageRequested = false,
		allowRemoval = false,
		trackTitle = 'Track'
	}: {
		id?: string;
		maxSizeMb: number;
		currentCoverImageUrl?: string | null;
		error?: string;
		needsReselection?: boolean;
		removeCoverImageRequested?: boolean;
		allowRemoval?: boolean;
		trackTitle?: string;
	} = $props();

	let previewUrl = $state<string | null>(null);
	let selectedFilename = $state('');
	let removeRequested = $state(untrack(() => removeCoverImageRequested));

	$effect(() => {
		removeRequested = removeCoverImageRequested;
	});

	const helpId = $derived(`${id}-help`);
	const errorId = $derived(`${id}-error`);
	const statusId = $derived(`${id}-status`);
	const reselectionId = $derived(`${id}-reselection`);
	const describedBy = $derived(
		[
			helpId,
			error ? errorId : null,
			selectedFilename ? statusId : null,
			needsReselection ? reselectionId : null
		]
			.filter(Boolean)
			.join(' ')
	);
	const displayedCoverUrl = $derived(
		removeRequested ? null : (previewUrl ?? currentCoverImageUrl)
	);

	function revokePreview(): void {
		if (previewUrl) {
			URL.revokeObjectURL(previewUrl);
			previewUrl = null;
		}
	}

	function handleFileChange(event: Event): void {
		revokePreview();
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		selectedFilename = file?.name ?? '';

		if (file) {
			removeRequested = false;
			previewUrl = URL.createObjectURL(file);
		}
	}

	onDestroy(revokePreview);
</script>

<div class="cover-image-field">
	<div class="cover-image-field__preview">
		<TrackCover
			coverImageUrl={displayedCoverUrl}
			title={trackTitle}
			variant="detail"
			decorative={false}
			loading="eager"
		/>
	</div>

	<div class="cover-image-field__control">
		<label for={id}>
			Cover image <span class="optional-label">(optional)</span>
		</label>
		<input
			class="file-input"
			{id}
			name="coverImage"
			type="file"
			accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={describedBy}
			onchange={handleFileChange}
		/>
		<p class="field-help" id={helpId}>
			JPEG, PNG, or WebP. Maximum file size: {maxSizeMb} MB. The server verifies the file
			type and image signature.
		</p>

		{#if selectedFilename}
			<p class="cover-image-field__status" id={statusId} aria-live="polite">
				Selected: <strong>{selectedFilename}</strong>
			</p>
		{/if}

		{#if error}
			<p class="field-error" id={errorId}>{error}</p>
		{/if}

		{#if needsReselection}
			<p class="file-reselection-note" id={reselectionId}>
				For security, browsers do not restore image selections after submission. Please
				select the cover image again if you had chosen one and still want to use it.
			</p>
		{/if}

		{#if allowRemoval && currentCoverImageUrl}
			<label class="cover-image-field__remove">
				<input
					name="removeCoverImage"
					type="checkbox"
					value="1"
					bind:checked={removeRequested}
					disabled={Boolean(selectedFilename)}
				/>
				<span>Remove the current cover image</span>
			</label>
		{/if}
	</div>
</div>

<style>
	.cover-image-field {
		display: grid;
		grid-template-columns: 8.5rem minmax(0, 1fr);
		gap: 1.25rem;
		align-items: start;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: color-mix(in srgb, var(--surface-muted) 78%, transparent);
	}

	.cover-image-field__preview {
		width: 100%;
		aspect-ratio: 1;
	}

	.cover-image-field__preview :global(.track-cover) {
		width: 100%;
		height: 100%;
	}

	.cover-image-field__control {
		min-width: 0;
	}

	.cover-image-field__control > label:first-child {
		display: inline-block;
		margin-bottom: 0.45rem;
	}

	.cover-image-field__status {
		margin: 0.5rem 0 0;
		color: var(--text-muted);
		font-size: 0.84rem;
		overflow-wrap: anywhere;
	}

	.cover-image-field__remove {
		display: flex;
		gap: 0.65rem;
		align-items: center;
		width: fit-content;
		margin-top: 0.85rem;
		color: var(--text);
		font-size: 0.9rem;
		font-weight: 700;
		cursor: pointer;
	}

	.cover-image-field__remove input {
		width: 1rem;
		height: 1rem;
		margin: 0;
		accent-color: var(--accent);
	}

	.cover-image-field__remove:has(input:disabled) {
		color: var(--text-muted);
		cursor: not-allowed;
	}

	@media (max-width: 38rem) {
		.cover-image-field {
			grid-template-columns: 5.75rem minmax(0, 1fr);
			gap: 0.9rem;
			padding: 0.8rem;
		}
	}
</style>

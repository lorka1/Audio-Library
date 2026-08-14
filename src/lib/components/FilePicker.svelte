<script lang="ts">
	let {
		id,
		name,
		accept,
		required = false,
		buttonLabel,
		emptyLabel = 'No file selected',
		ariaInvalid,
		ariaDescribedBy,
		onchange
	}: {
		id: string;
		name: string;
		accept: string;
		required?: boolean;
		buttonLabel: string;
		emptyLabel?: string;
		ariaInvalid?: 'true' | undefined;
		ariaDescribedBy?: string;
		onchange?: (event: Event) => void;
	} = $props();

	let files = $state<FileList | undefined>();
	const filenameId = $derived(`${id}-filename`);
	const selectedFilename = $derived(files?.[0]?.name ?? '');
	const displayedFilename = $derived(selectedFilename || emptyLabel);
	const describedBy = $derived([ariaDescribedBy, filenameId].filter(Boolean).join(' '));

	function handleChange(event: Event): void {
		onchange?.(event);
	}
</script>

<div class="file-picker-container">
	<div class="file-picker">
		<input
			class="file-picker__input"
			{id}
			{name}
			type="file"
			{accept}
			{required}
			bind:files
			aria-invalid={ariaInvalid}
			aria-describedby={describedBy}
			onchange={handleChange}
		/>
		<label class="file-picker__button" for={id}>{buttonLabel}</label>
		<span
			class="file-picker__filename"
			class:file-picker__filename--empty={!selectedFilename}
			id={filenameId}
			title={selectedFilename || undefined}
			aria-live="polite"
		>
			{displayedFilename}
		</span>
	</div>
</div>

<style>
	.file-picker-container {
		container-type: inline-size;
		min-width: 0;
	}

	.file-picker {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		gap: 0.65rem;
		min-width: 0;
	}

	.file-picker__input {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.file-picker__button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: var(--control-height);
		max-width: 100%;
		padding: 0.7rem 0.85rem;
		color: var(--text);
		border: 1px solid var(--accent-border);
		border-radius: var(--radius-control);
		background: var(--accent-soft);
		font-size: 0.88rem;
		font-weight: 750;
		line-height: 1.2;
		text-align: center;
		cursor: pointer;
	}

	.file-picker__button:hover {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 16%, var(--surface));
	}

	.file-picker__input:focus-visible + .file-picker__button {
		outline: 3px solid var(--focus-ring);
		outline-offset: 3px;
	}

	.file-picker__filename {
		min-width: 0;
		overflow: hidden;
		color: var(--text-muted);
		font-size: 0.86rem;
		line-height: 1.35;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file-picker__filename--empty {
		overflow: visible;
		text-overflow: clip;
		white-space: normal;
	}

	@container (max-width: 15rem) {
		.file-picker {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.45rem;
		}

		.file-picker__button {
			justify-self: start;
		}
	}
</style>

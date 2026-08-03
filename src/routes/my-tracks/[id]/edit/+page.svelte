<script lang="ts">
	import CoverImageField from '$lib/components/CoverImageField.svelte';
	import { MUSIC_GENRES, MUSICAL_KEYS } from '$lib/constants/music';
	import { formatFileSize } from '$lib/formatting';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const values = $derived(
		form?.values ?? {
			title: data.track.title,
			bpm: data.track.bpm === null ? '' : String(data.track.bpm),
			musicalKey: data.track.musicalKey ?? '',
			genre: data.track.genre ?? '',
			description: data.track.description ?? ''
		}
	);
	const hasInvalidMusicalKey = $derived(
		values.musicalKey !== '' &&
			!MUSICAL_KEYS.some((musicalKey) => musicalKey === values.musicalKey)
	);
	const hasInvalidGenre = $derived(
		values.genre !== '' && !MUSIC_GENRES.some((genre) => genre === values.genre)
	);
</script>

<svelte:head>
	<title>Edit {data.track.title} · Audio Library</title>
	<meta name="description" content="Edit metadata for an audio track you own." />
</svelte:head>

<section class="management-page">
	<div class="page-container management-form-container">
		<a class="back-link" href="/my-tracks">← Back to My Tracks</a>

		<div class="management-card">
			<header>
				<p class="auth-eyebrow">Owner-only metadata</p>
				<h1>Edit track</h1>
				<p>
					Update descriptive metadata and optional cover artwork. The audio file, ownership,
					visibility, and track identifiers will not change.
				</p>
			</header>

			<div class="readonly-track-summary">
				<p><strong>Artist:</strong> {data.track.artist}</p>
				<p><strong>Audio file:</strong> {data.track.originalFilename}</p>
				<p><strong>File size:</strong> {formatFileSize(data.track.fileSizeBytes)}</p>
				<p>
					<strong>Visibility:</strong>
					<span class:private={data.track.visibility === 'private'}>
						{data.track.visibility === 'public' ? 'Public' : 'Private'}
					</span>
				</p>
			</div>

			{#if form?.errors.general}
				<div class="form-message form-message--error" role="alert">
					{form.errors.general}
				</div>
			{/if}

			<form method="POST" enctype="multipart/form-data" class="form-stack">
				<CoverImageField
					maxSizeMb={data.maxCoverImageSizeMb}
					currentCoverImageUrl={data.track.coverImageUrl}
					error={form?.errors.coverImage}
					needsReselection={form?.needsCoverImageReselection}
					removeCoverImageRequested={form?.removeCoverImageRequested}
					allowRemoval={true}
					trackTitle={values.title || data.track.title}
				/>

				<div class="upload-form-grid">
					<div class="form-field">
						<label for="title">Title</label>
						<input
							id="title"
							name="title"
							type="text"
							required
							maxlength="120"
							value={values.title}
							aria-invalid={form?.errors.title ? 'true' : undefined}
							aria-describedby={form?.errors.title ? 'title-error' : undefined}
						/>
						{#if form?.errors.title}
							<p class="field-error" id="title-error">{form.errors.title}</p>
						{/if}
					</div>

					<div class="form-field">
						<label for="bpm">BPM <span class="optional-label">(optional)</span></label>
						<input
							id="bpm"
							name="bpm"
							type="number"
							inputmode="numeric"
							min="20"
							max="300"
							step="1"
							value={values.bpm}
							aria-invalid={form?.errors.bpm ? 'true' : undefined}
							aria-describedby={form?.errors.bpm ? 'bpm-help bpm-error' : 'bpm-help'}
						/>
						<p class="field-help" id="bpm-help">Enter a whole number from 20 to 300.</p>
						{#if form?.errors.bpm}
							<p class="field-error" id="bpm-error">{form.errors.bpm}</p>
						{/if}
					</div>

					<div class="form-field">
						<label for="musicalKey">Musical key <span class="optional-label">(optional)</span></label>
						<select
							id="musicalKey"
							name="musicalKey"
							aria-invalid={form?.errors.musicalKey ? 'true' : undefined}
							aria-describedby={form?.errors.musicalKey ? 'musical-key-error' : undefined}
						>
							{#if hasInvalidMusicalKey}
								<option value={values.musicalKey} selected disabled>
									Invalid selection: {values.musicalKey}
								</option>
							{/if}
							<option value="" selected={values.musicalKey === ''}>Not specified</option>
							{#each MUSICAL_KEYS as musicalKey}
								<option value={musicalKey} selected={values.musicalKey === musicalKey}>
									{musicalKey}
								</option>
							{/each}
						</select>
						{#if form?.errors.musicalKey}
							<p class="field-error" id="musical-key-error">{form.errors.musicalKey}</p>
						{/if}
					</div>

					<div class="form-field">
						<label for="genre">Genre <span class="optional-label">(optional)</span></label>
						<select
							id="genre"
							name="genre"
							aria-invalid={form?.errors.genre ? 'true' : undefined}
							aria-describedby={form?.errors.genre ? 'genre-error' : undefined}
						>
							{#if hasInvalidGenre}
								<option value={values.genre} selected disabled>
									Invalid selection: {values.genre}
								</option>
							{/if}
							<option value="" selected={values.genre === ''}>Not specified</option>
							{#each MUSIC_GENRES as genre}
								<option value={genre} selected={values.genre === genre}>{genre}</option>
							{/each}
						</select>
						{#if form?.errors.genre}
							<p class="field-error" id="genre-error">{form.errors.genre}</p>
						{/if}
					</div>

					<div class="form-field form-field--full">
						<label for="description">
							Description <span class="optional-label">(optional)</span>
						</label>
						<textarea
							id="description"
							name="description"
							rows="6"
							maxlength="2000"
							aria-invalid={form?.errors.description ? 'true' : undefined}
							aria-describedby={form?.errors.description
								? 'description-help description-error'
								: 'description-help'}>{values.description}</textarea
						>
						<p class="field-help" id="description-help">Up to 2,000 characters.</p>
						{#if form?.errors.description}
							<p class="field-error" id="description-error">{form.errors.description}</p>
						{/if}
					</div>
				</div>

				<div class="management-actions">
					<button class="primary-button" type="submit">Save changes</button>
					<a class="secondary-button" href="/my-tracks">Cancel</a>
				</div>
			</form>
		</div>
	</div>
</section>

<style>
	.management-form-container {
		max-width: 58rem;
	}

	.management-card {
		padding: clamp(1.5rem, 5vw, 2.75rem);
		border: 1px solid var(--border);
		border-radius: 1.25rem;
		background: var(--surface);
		box-shadow: var(--shadow-card);
	}

	header {
		max-width: 44rem;
		margin-bottom: 1.5rem;
	}

	h1 {
		margin: 0;
		font-size: clamp(2rem, 6vw, 3rem);
		line-height: 1.05;
		letter-spacing: -0.045em;
	}

	header > p:last-child {
		margin: 1rem 0 0;
		color: var(--text-muted);
		line-height: 1.65;
	}

	.readonly-track-summary {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem 1.25rem;
		margin-bottom: 1.5rem;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		background: var(--surface-muted);
	}

	.readonly-track-summary p {
		margin: 0;
		font-size: 0.86rem;
		overflow-wrap: anywhere;
	}

	.readonly-track-summary span {
		color: var(--success);
		font-weight: 800;
	}

	.readonly-track-summary span.private {
		color: var(--warning);
	}

	.management-actions {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.management-actions a {
		color: var(--accent-strong);
		font-weight: 750;
	}

	@media (max-width: 36rem) {
		.management-actions {
			align-items: stretch;
			flex-direction: column;
		}

		.management-actions a {
			padding: 0.5rem;
			text-align: center;
		}
	}
</style>

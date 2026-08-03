<script lang="ts">
	import CoverImageField from '$lib/components/CoverImageField.svelte';
	import { MUSIC_GENRES, MUSICAL_KEYS } from '$lib/constants/music';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const selectedMusicalKey = $derived(form?.values.musicalKey ?? '');
	const selectedGenre = $derived(form?.values.genre ?? '');
	const hasInvalidMusicalKey = $derived(
		selectedMusicalKey !== '' && !MUSICAL_KEYS.some((value) => value === selectedMusicalKey)
	);
	const hasInvalidGenre = $derived(
		selectedGenre !== '' && !MUSIC_GENRES.some((value) => value === selectedGenre)
	);
</script>

<svelte:head>
	<title>Upload audio · Audio Library</title>
	<meta
		name="description"
		content="Upload an audio track and publish it in the Audio Library."
	/>
</svelte:head>

<section class="upload-page">
	<div class="page-container upload-page__inner">
		<div class="upload-card">
			<header class="upload-card__header">
				<p class="auth-eyebrow">Public audio upload</p>
				<h1>Add a track to your library.</h1>
				<p>
					Choose an MP3, WAV, or OGG file and describe the track. The audio file is stored
					privately, linked to your account, and published for public playback and download.
				</p>
			</header>

			{#if form?.errors.general}
				<div class="form-message form-message--error" role="alert">
					{form.errors.general}
				</div>
			{/if}

			<form
				method="POST"
				action="/upload"
				enctype="multipart/form-data"
				class="form-stack"
			>
				<div class="form-field form-field--full">
					<label for="audioFile">Audio file</label>
					<input
						class="file-input"
						id="audioFile"
						name="audioFile"
						type="file"
						accept="audio/mpeg,audio/wav,audio/x-wav,audio/wave,audio/vnd.wave,audio/ogg,.mp3,.wav,.ogg"
						required
						aria-invalid={form?.errors.audioFile ? 'true' : undefined}
						aria-describedby={form?.errors.audioFile
							? form.needsAudioFileReselection
								? 'audio-file-help audio-file-error audio-file-reselection'
								: 'audio-file-help audio-file-error'
							: form?.needsAudioFileReselection
								? 'audio-file-help audio-file-reselection'
								: 'audio-file-help'}
					/>
					<p class="field-help" id="audio-file-help">
						MP3, WAV, or OGG. Maximum file size: {data.maxAudioFileSizeMb} MB. The server
						validates both the filename extension and MIME type.
					</p>
					{#if form?.errors.audioFile}
						<p class="field-error" id="audio-file-error">{form.errors.audioFile}</p>
					{/if}
					{#if form?.needsAudioFileReselection}
						<p class="file-reselection-note" id="audio-file-reselection">
							For security, browsers do not restore file selections after submission. Please
							select the audio file again.
						</p>
					{/if}
				</div>

				<CoverImageField
					maxSizeMb={data.maxCoverImageSizeMb}
					error={form?.errors.coverImage}
					needsReselection={form?.needsCoverImageReselection}
					trackTitle={form?.values.title || 'New track'}
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
							value={form?.values.title ?? ''}
							aria-invalid={form?.errors.title ? 'true' : undefined}
							aria-describedby={form?.errors.title ? 'title-error' : undefined}
						/>
						{#if form?.errors.title}
							<p class="field-error" id="title-error">{form.errors.title}</p>
						{/if}
					</div>

					<div class="form-field">
						<label for="artist">Artist</label>
						<input
							id="artist"
							name="artist"
							type="text"
							required
							maxlength="120"
							value={form?.values.artist ?? ''}
							aria-invalid={form?.errors.artist ? 'true' : undefined}
							aria-describedby={form?.errors.artist ? 'artist-error' : undefined}
						/>
						{#if form?.errors.artist}
							<p class="field-error" id="artist-error">{form.errors.artist}</p>
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
							value={form?.values.bpm ?? ''}
							aria-invalid={form?.errors.bpm ? 'true' : undefined}
							aria-describedby={form?.errors.bpm ? 'bpm-help bpm-error' : 'bpm-help'}
						/>
						<p class="field-help" id="bpm-help">Enter a whole number from 20 to 300.</p>
						{#if form?.errors.bpm}
							<p class="field-error" id="bpm-error">{form.errors.bpm}</p>
						{/if}
					</div>

					<div class="form-field">
						<label for="musicalKey">
							Musical key <span class="optional-label">(optional)</span>
						</label>
						<select
							id="musicalKey"
							name="musicalKey"
							aria-invalid={form?.errors.musicalKey ? 'true' : undefined}
							aria-describedby={form?.errors.musicalKey ? 'musical-key-error' : undefined}
						>
							{#if hasInvalidMusicalKey}
								<option value={selectedMusicalKey} selected disabled>
									Invalid selection: {selectedMusicalKey}
								</option>
							{/if}
							<option value="" selected={selectedMusicalKey === ''}>Not specified</option>
							{#each MUSICAL_KEYS as musicalKey}
								<option value={musicalKey} selected={selectedMusicalKey === musicalKey}>
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
								<option value={selectedGenre} selected disabled>
									Invalid selection: {selectedGenre}
								</option>
							{/if}
							<option value="" selected={selectedGenre === ''}>Not specified</option>
							{#each MUSIC_GENRES as genre}
								<option value={genre} selected={selectedGenre === genre}>{genre}</option>
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
								: 'description-help'}>{form?.values.description ?? ''}</textarea
						>
						<p class="field-help" id="description-help">Up to 2,000 characters.</p>
						{#if form?.errors.description}
							<p class="field-error" id="description-error">{form.errors.description}</p>
						{/if}
					</div>
				</div>

				<button class="primary-button" type="submit">Upload audio track</button>
			</form>
		</div>
	</div>
</section>

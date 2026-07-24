<script lang="ts">
	import { MUSIC_GENRES, MUSICAL_KEYS } from '$lib/constants/music';
	import {
		TRACK_SORT_OPTIONS,
		type TrackFilterValues,
		type TrackQueryErrors
	} from '$lib/tracks-query';

	let {
		values,
		errors
	}: {
		values: TrackFilterValues;
		errors: TrackQueryErrors;
	} = $props();

	const errorMessages = $derived(
		Object.values(errors).filter((message): message is string => Boolean(message))
	);
	const hasInvalidMusicalKey = $derived(
		values.musicalKey !== '' &&
			!MUSICAL_KEYS.some((musicalKey) => musicalKey === values.musicalKey)
	);
	const hasInvalidGenre = $derived(
		values.genre !== '' && !MUSIC_GENRES.some((genre) => genre === values.genre)
	);
</script>

<section class="track-filters" aria-labelledby="track-filters-title">
	<div class="track-filters__heading">
		<div>
			<p class="auth-eyebrow">Refine the library</p>
			<h2 id="track-filters-title">Search and filters</h2>
		</div>
		<a class="track-filters__reset" href="/tracks">Reset filters</a>
	</div>

	{#if errorMessages.length > 0}
		<div class="filter-errors" role="alert" aria-labelledby="filter-errors-title">
			<p id="filter-errors-title">Please correct the following filters:</p>
			<ul>
				{#each errorMessages as message}
					<li>{message}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<form method="GET" action="/tracks" class="track-filters__form">
		<div class="form-field track-filters__search">
			<label for="track-search">Search</label>
			<input
				id="track-search"
				name="q"
				type="search"
				maxlength="100"
				placeholder="Title, artist, or description"
				value={values.q}
				aria-invalid={errors.q ? 'true' : undefined}
				aria-describedby={errors.q ? 'track-search-help track-search-error' : 'track-search-help'}
			/>
			<p class="field-help" id="track-search-help">
				Partial matches are case-insensitive. %, _, and \ are treated literally.
			</p>
			{#if errors.q}
				<p class="field-error" id="track-search-error">{errors.q}</p>
			{/if}
		</div>

		<div class="form-field">
			<label for="track-bpm-min">Minimum BPM</label>
			<input
				id="track-bpm-min"
				name="bpmMin"
				type="number"
				inputmode="numeric"
				min="20"
				max="300"
				step="1"
				value={values.bpmMin}
				aria-invalid={errors.bpmMin || errors.bpmRange ? 'true' : undefined}
				aria-describedby={errors.bpmMin
					? 'track-bpm-help track-bpm-min-error'
					: errors.bpmRange
						? 'track-bpm-help track-bpm-range-error'
						: 'track-bpm-help'}
			/>
			{#if errors.bpmMin}
				<p class="field-error" id="track-bpm-min-error">{errors.bpmMin}</p>
			{/if}
		</div>

		<div class="form-field">
			<label for="track-bpm-max">Maximum BPM</label>
			<input
				id="track-bpm-max"
				name="bpmMax"
				type="number"
				inputmode="numeric"
				min="20"
				max="300"
				step="1"
				value={values.bpmMax}
				aria-invalid={errors.bpmMax || errors.bpmRange ? 'true' : undefined}
				aria-describedby={errors.bpmMax
					? 'track-bpm-help track-bpm-max-error'
					: errors.bpmRange
						? 'track-bpm-help track-bpm-range-error'
						: 'track-bpm-help'}
			/>
			{#if errors.bpmMax}
				<p class="field-error" id="track-bpm-max-error">{errors.bpmMax}</p>
			{/if}
		</div>

		<p class="track-filters__bpm-help field-help" id="track-bpm-help">
			Optional whole numbers from 20 through 300.
		</p>

		{#if errors.bpmRange}
			<p class="track-filters__range-error field-error" id="track-bpm-range-error">
				{errors.bpmRange}
			</p>
		{/if}

		<div class="form-field">
			<label for="track-musical-key">Musical key</label>
			<select
				id="track-musical-key"
				name="musicalKey"
				aria-invalid={errors.musicalKey ? 'true' : undefined}
				aria-describedby={errors.musicalKey ? 'track-musical-key-error' : undefined}
			>
				{#if hasInvalidMusicalKey}
					<option value={values.musicalKey} selected disabled>
						Invalid selection: {values.musicalKey}
					</option>
				{/if}
				<option value="" selected={values.musicalKey === ''}>Any key</option>
				{#each MUSICAL_KEYS as musicalKey}
					<option value={musicalKey} selected={values.musicalKey === musicalKey}>
						{musicalKey}
					</option>
				{/each}
			</select>
			{#if errors.musicalKey}
				<p class="field-error" id="track-musical-key-error">{errors.musicalKey}</p>
			{/if}
		</div>

		<div class="form-field">
			<label for="track-genre">Genre</label>
			<select
				id="track-genre"
				name="genre"
				aria-invalid={errors.genre ? 'true' : undefined}
				aria-describedby={errors.genre ? 'track-genre-error' : undefined}
			>
				{#if hasInvalidGenre}
					<option value={values.genre} selected disabled>
						Invalid selection: {values.genre}
					</option>
				{/if}
				<option value="" selected={values.genre === ''}>Any genre</option>
				{#each MUSIC_GENRES as genre}
					<option value={genre} selected={values.genre === genre}>{genre}</option>
				{/each}
			</select>
			{#if errors.genre}
				<p class="field-error" id="track-genre-error">{errors.genre}</p>
			{/if}
		</div>

		<div class="form-field">
			<label for="track-sort">Sort</label>
			<select id="track-sort" name="sort">
				{#each TRACK_SORT_OPTIONS as option}
					<option value={option.value} selected={values.sort === option.value}>
						{option.label}
					</option>
				{/each}
			</select>
		</div>

		<div class="track-filters__actions">
			<button class="primary-button" type="submit">Apply filters</button>
			<a href="/tracks">Reset filters</a>
		</div>
	</form>
</section>

<style>
	.track-filters {
		margin-bottom: 2rem;
		padding: clamp(1.25rem, 4vw, 2rem);
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: var(--surface);
		box-shadow: 0 1rem 3rem rgb(24 32 51 / 5%);
	}

	.track-filters__heading {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	h2 {
		margin: 0;
		font-size: clamp(1.35rem, 4vw, 1.8rem);
		letter-spacing: -0.035em;
	}

	.track-filters__reset,
	.track-filters__actions a {
		color: var(--accent-strong);
		font-size: 0.88rem;
		font-weight: 750;
		text-underline-offset: 0.2em;
	}

	.filter-errors {
		margin-bottom: 1.25rem;
		padding: 0.9rem 1rem;
		color: #8e2438;
		border: 1px solid #efbdc6;
		border-radius: 0.65rem;
		background: #fff1f3;
		font-size: 0.88rem;
		line-height: 1.5;
	}

	.filter-errors p {
		margin: 0;
		font-weight: 750;
	}

	.filter-errors ul {
		margin: 0.4rem 0 0;
		padding-left: 1.2rem;
	}

	.track-filters__form {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 1rem;
		align-items: start;
	}

	.track-filters__search {
		grid-column: span 3;
	}

	.track-filters__form > .form-field:not(.track-filters__search) {
		grid-column: span 1;
	}

	.track-filters__bpm-help,
	.track-filters__range-error {
		grid-column: 4 / span 2;
		margin-top: -0.6rem;
	}

	.track-filters__range-error {
		margin-top: -0.35rem;
	}

	.track-filters__actions {
		display: flex;
		grid-column: 1 / -1;
		align-items: center;
		gap: 1rem;
		padding-top: 0.25rem;
	}

	.track-filters__actions .primary-button {
		min-width: 9rem;
	}

	@media (max-width: 58rem) {
		.track-filters__form {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.track-filters__search,
		.track-filters__form > .form-field:not(.track-filters__search) {
			grid-column: span 1;
		}

		.track-filters__search {
			grid-column: 1 / -1;
		}

		.track-filters__bpm-help,
		.track-filters__range-error {
			grid-column: 1 / -1;
		}
	}

	@media (max-width: 36rem) {
		.track-filters__heading {
			align-items: flex-start;
			flex-direction: column;
		}

		.track-filters__form {
			grid-template-columns: 1fr;
		}

		.track-filters__search,
		.track-filters__form > .form-field:not(.track-filters__search) {
			grid-column: 1;
		}

		.track-filters__actions {
			align-items: stretch;
			flex-direction: column;
		}

		.track-filters__actions a {
			padding: 0.5rem;
			text-align: center;
		}
	}
</style>

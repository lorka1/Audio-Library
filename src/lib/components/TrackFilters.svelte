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
			<p class="auth-eyebrow">
				<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
					<path d="M4 5h16l-6.3 7.1V18l-3.4 1v-6.9z"></path>
				</svg>
				Refine your search
			</p>
			<h2 id="track-filters-title">Search and filters</h2>
		</div>
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
			<div class="track-filters__input-wrap">
				<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
					<path d="M10.7 4a6.7 6.7 0 1 0 4.2 11.9l4 4 1.1-1.1-4-4A6.7 6.7 0 0 0 10.7 4m0 1.7a5 5 0 1 1 0 10 5 5 0 0 1 0-10"></path>
				</svg>
				<input
					id="track-search"
					name="q"
					type="search"
					maxlength="100"
					placeholder="Search by title, artist, or description"
					value={values.q}
					aria-invalid={errors.q ? 'true' : undefined}
					aria-describedby={errors.q
						? 'track-search-help track-search-error'
						: 'track-search-help'}
				/>
			</div>
			<p class="field-help" id="track-search-help">
				Partial matches are case-insensitive. %, _, and \ are treated literally.
			</p>
			{#if errors.q}
				<p class="field-error" id="track-search-error">{errors.q}</p>
			{/if}
		</div>

		<div class="track-filters__bpm-group">
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
		</div>

		<div class="form-field track-filters__select">
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

		<div class="form-field track-filters__select">
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

		<div class="form-field track-filters__select">
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
			<button class="primary-button" type="submit">
				<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
					<path d="M4 5h16l-6.3 7.1V18l-3.4 1v-6.9z"></path>
				</svg>
				Apply filters
			</button>
			<a href="/tracks">Reset filters</a>
		</div>
	</form>
</section>

<style>
	.track-filters {
		margin-bottom: 2rem;
		padding: clamp(1.25rem, 3vw, 1.8rem);
		color: #131a2c;
		border: 1px solid rgb(226 230 240 / 82%);
		border-radius: 0.95rem;
		background:
			radial-gradient(circle at 84% 10%, rgb(116 79 247 / 5%), transparent 24rem),
			#f7f8fc;
		box-shadow: 0 1.5rem 4rem rgb(0 2 15 / 32%);
		color-scheme: light;
	}

	.track-filters__heading {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.3rem;
	}

	h2 {
		margin: 0;
		color: #151d32;
		font-size: clamp(1.25rem, 3vw, 1.55rem);
		letter-spacing: -0.035em;
	}

	.track-filters .auth-eyebrow {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		margin-bottom: 0.55rem;
		color: #5139d8;
	}

	.track-filters .auth-eyebrow svg {
		width: 1rem;
		height: 1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linejoin: round;
	}

	.track-filters__actions a {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: var(--control-height);
		min-width: 8.5rem;
		padding: 0.7rem 1rem;
		color: #5139d8;
		border: 1px solid #8f7af0;
		border-radius: var(--radius-control);
		background: transparent;
		font-size: 0.86rem;
		font-weight: 750;
		text-decoration: none;
		transition:
			background-color 150ms ease,
			border-color 150ms ease;
	}

	.track-filters__actions a:hover {
		border-color: #6547ef;
		background: #eeebff;
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
		grid-template-columns: repeat(10, minmax(0, 1fr));
		gap: 1.25rem 1rem;
		align-items: start;
	}

	.track-filters__search {
		grid-column: span 5;
	}

	.track-filters__bpm-group {
		display: grid;
		grid-column: span 5;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.45rem 1rem;
		min-width: 0;
	}

	.track-filters__select {
		grid-column: span 2;
	}

	.track-filters .form-field label {
		color: #161e32;
		font-size: 0.82rem;
	}

	.track-filters .form-field input,
	.track-filters .form-field select {
		color: #182036;
		border-color: #ccd3e1;
		background-color: white;
	}

	.track-filters .form-field input::placeholder {
		color: #7d869b;
	}

	.track-filters .form-field input:hover,
	.track-filters .form-field select:hover {
		border-color: #a9b2c5;
		background-color: white;
	}

	.track-filters .form-field input:focus,
	.track-filters .form-field select:focus {
		border-color: #6847f5;
		box-shadow: 0 0 0 3px rgb(104 71 245 / 18%);
	}

	.track-filters .field-help {
		color: #687187;
	}

	.track-filters__input-wrap {
		position: relative;
	}

	.track-filters__input-wrap svg {
		position: absolute;
		z-index: 1;
		top: 50%;
		left: 1rem;
		width: 1.1rem;
		height: 1.1rem;
		fill: #727d94;
		transform: translateY(-50%);
		pointer-events: none;
	}

	.track-filters__input-wrap input {
		padding-left: 2.8rem;
	}

	.track-filters__bpm-help,
	.track-filters__range-error {
		grid-column: 1 / -1;
		margin: 0;
	}

	.track-filters__actions {
		display: flex;
		align-items: center;
		align-self: start;
		justify-content: flex-end;
		grid-column: span 4;
		gap: 0.75rem;
		min-width: 0;
		padding-top: 1.62rem;
	}

	.track-filters__actions .primary-button {
		gap: 0.45rem;
		min-width: 9.25rem;
		box-shadow: 0 0.6rem 1.4rem rgb(82 54 209 / 18%);
	}

	.track-filters__actions .primary-button svg {
		width: 1rem;
		height: 1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linejoin: round;
	}

	@media (max-width: 68.75rem) {
		.track-filters__form {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.track-filters__search,
		.track-filters__bpm-group {
			grid-column: 1 / -1;
		}

		.track-filters__actions {
			grid-column: span 1;
			justify-content: flex-start;
			padding-top: 1.55rem;
		}

		.track-filters__select {
			grid-column: span 1;
		}
	}

	@media (max-width: 43.75rem) {
		.track-filters__form {
			grid-template-columns: 1fr;
		}

		.track-filters__search,
		.track-filters__bpm-group,
		.track-filters__form > .form-field,
		.track-filters__actions {
			grid-column: 1;
		}

		.track-filters__bpm-group {
			grid-template-columns: 1fr;
		}

		.track-filters__bpm-help,
		.track-filters__range-error {
			grid-column: 1;
		}

		.track-filters__actions {
			align-items: stretch;
			flex-direction: column;
			padding-top: 0;
		}

		.track-filters__actions a {
			text-align: center;
		}

		.track-filters__actions .primary-button,
		.track-filters__actions a {
			width: 100%;
		}
	}
</style>

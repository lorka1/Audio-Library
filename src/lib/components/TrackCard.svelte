<script lang="ts">
	import { formatDate } from '$lib/formatting';
	import type { AudioPlayerController } from '$lib/player/controller';
	import { toPublicPlayerTrack } from '$lib/player/model';
	import type { PlaylistPickerEntry, PublicTrack } from '$lib/types';
	import AddToPlaylist from './AddToPlaylist.svelte';
	import TrackCover from './TrackCover.svelte';
	import TrackPlayButton from './TrackPlayButton.svelte';

	let {
		track,
		player,
		playlistChoices = null,
		loginHref = `/login?redirectTo=${encodeURIComponent(`/tracks/${track.id}`)}`
	}: {
		track: PublicTrack;
		player?: AudioPlayerController;
		playlistChoices?: PlaylistPickerEntry[] | null;
		loginHref?: string;
	} = $props();
	let playerTrack = $derived(toPublicPlayerTrack(track));
</script>

<article class="track-card">
	<TrackCover
		coverImageUrl={track.coverImageUrl}
		title={track.title}
		variant="row"
	/>

	<TrackPlayButton track={playerTrack} {player} variant="icon" />

	<header class="track-card__identity">
		<div class="track-card__title">
			<h2><a href={`/tracks/${track.id}`}>{track.title}</a></h2>
			<p class="track-card__artist">{track.artist}</p>
		</div>
		<p class="track-card__owner">
			Uploaded by {track.ownerUsername} ·
			<time datetime={track.createdAt}>{formatDate(track.createdAt)}</time>
		</p>
	</header>

	<p class="track-card__genre">{track.genre ?? 'No genre'}</p>

	<dl class="track-card__metadata">
		<div>
			<dt>BPM</dt>
			<dd>{track.bpm ?? '—'}</dd>
		</div>
		<div>
			<dt>Key</dt>
			<dd>{track.musicalKey ?? '—'}</dd>
		</div>
	</dl>

	<div class="track-card__actions">
		<AddToPlaylist
			trackId={track.id}
			trackTitle={track.title}
			choices={playlistChoices}
			{loginHref}
		/>
		<a
			href={`/api/tracks/${track.id}/download`}
			aria-label={`Download ${track.title}`}
			title="Download audio"
		>
			<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
				<path d="M11 4h2v9.2l3-3 1.4 1.4-5.4 5.4-5.4-5.4L8 10.2l3 3zM5 18h14v2H5z"></path>
			</svg>
		</a>
		<a
			href={`/tracks/${track.id}`}
			aria-label={`View details for ${track.title}`}
			title="View track details"
		>
			<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
				<path d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16m0 1.8a6.2 6.2 0 1 1 0 12.4 6.2 6.2 0 0 1 0-12.4m-.9 2.7h1.8v1.8h-1.8zm0 3.2h1.8v4.1h-1.8z"></path>
			</svg>
		</a>
	</div>
</article>

<style>
	.track-card {
		display: grid;
		grid-template-columns:
			3.5rem 2.75rem minmax(12rem, 2fr) minmax(6.5rem, 0.75fr)
			minmax(8.5rem, 0.85fr) auto;
		align-items: center;
		gap: 0.85rem 1rem;
		min-width: 0;
		padding: 0.65rem 0.85rem;
		border: 1px solid var(--border);
		border-radius: 0.85rem;
		background: var(--card-background);
		box-shadow: var(--shadow-card);
		transition:
			border-color 160ms ease,
			background-color 160ms ease,
			transform 160ms ease;
	}

	.track-card:hover {
		border-color: var(--accent-border);
		background: var(--card-background-hover);
		transform: translateY(-1px);
	}

	.track-card__identity {
		min-width: 0;
	}

	.track-card__title {
		min-width: 0;
	}

	.track-card__artist {
		margin: 0.22rem 0 0;
		color: var(--text-muted);
		font-size: 0.82rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.track-card__owner {
		margin: 0.22rem 0 0;
		color: var(--text-subtle);
		font-size: 0.68rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	h2 {
		margin: 0;
		font-size: 0.98rem;
		line-height: 1.2;
		letter-spacing: -0.015em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	h2 a {
		text-decoration: none;
	}

	h2 a:hover {
		color: var(--link);
	}

	.track-card__genre {
		width: fit-content;
		max-width: 100%;
		margin: 0;
		padding: 0.3rem 0.55rem;
		overflow: hidden;
		color: var(--link);
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--accent-soft);
		font-size: 0.72rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.track-card__metadata {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
		margin: 0;
	}

	.track-card__metadata div {
		min-width: 0;
		padding: 0;
	}

	dt {
		color: var(--text-subtle);
		font-size: 0.58rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	dd {
		margin: 0.2rem 0 0;
		color: var(--text);
		font-size: 0.8rem;
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.track-card__actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.25rem;
	}

	.track-card__actions :global(.playlist-trigger),
	.track-card__actions :global(.playlist-login-link) {
		min-height: 2.45rem;
		white-space: nowrap;
	}

	.track-card__actions a {
		display: inline-grid;
		place-items: center;
		width: 2.45rem;
		height: 2.45rem;
		color: var(--text-muted);
		border: 1px solid transparent;
		border-radius: 999px;
		transition:
			color 150ms ease,
			border-color 150ms ease,
			background-color 150ms ease;
	}

	.track-card__actions a:hover {
		color: var(--link);
		border-color: var(--accent-border);
		background: var(--accent-soft);
	}

	.track-card__actions svg {
		width: 1.15rem;
		height: 1.15rem;
		fill: currentColor;
	}

	@media (max-width: 58rem) {
		.track-card {
			grid-template-columns: 3.5rem 2.75rem minmax(0, 1fr) auto;
		}

		.track-card__identity {
			grid-column: 3;
		}

		.track-card__genre {
			grid-column: 3;
			grid-row: 2;
		}

		.track-card__metadata {
			grid-column: 3;
			grid-row: 3;
			justify-self: start;
			width: min(100%, 16rem);
		}

		.track-card__actions {
			grid-column: 4;
			grid-row: 1 / span 3;
		}

		.track-card > :global(.track-cover) {
			grid-row: 1 / span 2;
			align-self: start;
		}

		.track-card > :global(button) {
			grid-row: 1 / span 2;
			align-self: start;
			margin-top: 0.35rem;
		}
	}

	@media (max-width: 37rem) {
		.track-card {
			grid-template-columns: 3.5rem minmax(0, 1fr) auto;
			gap: 0.65rem 0.8rem;
		}

		.track-card > :global(button) {
			grid-column: 3;
			grid-row: 1;
			margin-top: 0.35rem;
		}

		.track-card__identity,
		.track-card__genre,
		.track-card__metadata {
			grid-column: 2;
		}

		.track-card__identity {
			grid-row: 1;
		}

		.track-card__genre {
			grid-row: 2;
		}

		.track-card__metadata {
			grid-row: 3;
		}

		.track-card__actions {
			grid-column: 3;
			grid-row: 2 / span 2;
			flex-direction: column;
		}

		.track-card__owner {
			display: none;
		}
	}
</style>

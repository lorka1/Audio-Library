<script lang="ts">
	import { formatDate } from '$lib/formatting';
	import { toPublicPlayerTrack } from '$lib/player/model';
	import type { OwnerTrack, PlaylistPickerEntry } from '$lib/types';
	import AddToPlaylist from './AddToPlaylist.svelte';
	import TrackCover from './TrackCover.svelte';
	import TrackPlayButton from './TrackPlayButton.svelte';

	let {
		track,
		playlistChoices = []
	}: { track: OwnerTrack; playlistChoices?: PlaylistPickerEntry[] } = $props();
	let playerTrack = $derived(
		toPublicPlayerTrack({
			id: track.publicId,
			title: track.title,
			artist: track.artist,
			coverImageUrl: track.coverImageUrl
		})
	);
</script>

<article class="owner-track-card">
	<header>
		<TrackCover
			coverImageUrl={track.coverImageUrl}
			title={track.title}
			variant="owner"
		/>
		<div class="owner-track-card__identity">
			<div class="owner-track-card__heading">
				<p>{track.artist}</p>
				<span class:private={track.visibility === 'private'}>
					{track.visibility === 'public' ? 'Public' : 'Private'}
				</span>
			</div>
			<h2>{track.title}</h2>
			<p class="owner-track-card__date">
				Uploaded <time datetime={track.createdAt}>{formatDate(track.createdAt)}</time>
			</p>
		</div>
	</header>

	<dl>
		<div>
			<dt>BPM</dt>
			<dd>{track.bpm ?? 'Not specified'}</dd>
		</div>
		<div>
			<dt>Musical key</dt>
			<dd>{track.musicalKey ?? 'Not specified'}</dd>
		</div>
		<div>
			<dt>Genre</dt>
			<dd>{track.genre ?? 'Not specified'}</dd>
		</div>
	</dl>

	<footer>
		<AddToPlaylist
			trackId={track.publicId}
			trackTitle={track.title}
			choices={playlistChoices}
			loginHref="/login?redirectTo=%2Fmy-tracks"
		/>
		{#if track.visibility === 'public'}
			<TrackPlayButton track={playerTrack} />
		{/if}
		<a href={`/my-tracks/${track.publicId}/edit`}>Edit metadata</a>
		<a class="delete-link" href={`/my-tracks/${track.publicId}/delete`}>Delete</a>
		{#if track.visibility === 'public'}
			<a href={`/tracks/${track.publicId}`}>View public page</a>
		{/if}
	</footer>
</article>

<style>
	.owner-track-card {
		display: grid;
		gap: 1.25rem;
		min-width: 0;
		padding: 1.5rem;
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: var(--card-background);
		box-shadow: var(--shadow-card);
		transition:
			border-color 150ms ease,
			box-shadow 150ms ease;
	}

	.owner-track-card:hover {
		border-color: var(--accent-border);
		box-shadow: var(--shadow-card-hover);
	}

	header {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		min-width: 0;
	}

	.owner-track-card__identity {
		flex: 1;
		min-width: 0;
	}

	.owner-track-card__heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.owner-track-card__heading p {
		margin: 0;
		color: var(--accent-strong);
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		overflow-wrap: anywhere;
	}

	.owner-track-card__heading span {
		flex: 0 0 auto;
		padding: 0.28rem 0.55rem;
		color: var(--success);
		border: 1px solid var(--success-border);
		border-radius: 999px;
		background: var(--success-bg);
		font-size: 0.72rem;
		font-weight: 800;
	}

	.owner-track-card__heading span.private {
		color: var(--warning);
		border-color: var(--warning-border);
		background: var(--warning-bg);
	}

	h2 {
		margin: 0.5rem 0 0;
		font-size: 1.35rem;
		line-height: 1.2;
		letter-spacing: -0.025em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	dl {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.75rem;
		margin: 0;
	}

	dl div {
		min-width: 0;
		padding: 0.75rem;
		border-radius: 0.65rem;
		border: 1px solid var(--border);
		background: var(--surface-secondary);
	}

	dt {
		color: var(--text-muted);
		font-size: 0.7rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	dd {
		margin: 0.3rem 0 0;
		font-size: 0.9rem;
		font-weight: 700;
		overflow-wrap: anywhere;
	}

	.owner-track-card__date {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.82rem;
	}

	footer {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.55rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}

	footer a {
		display: inline-flex;
		padding: 0.55rem 0.7rem;
		color: var(--link);
		border: 1px solid var(--accent-border);
		border-radius: 0.55rem;
		font-size: 0.82rem;
		font-weight: 750;
		text-decoration: none;
	}

	footer a:hover {
		background: var(--accent-soft);
	}

	footer .delete-link {
		color: var(--error);
		border-color: var(--error-border);
	}

	footer .delete-link:hover {
		background: var(--error-bg);
	}

	@media (max-width: 28rem) {
		dl {
			grid-template-columns: 1fr;
		}
	}
</style>

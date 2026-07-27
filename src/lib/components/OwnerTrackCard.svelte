<script lang="ts">
	import { formatDate } from '$lib/formatting';
	import { toPublicPlayerTrack } from '$lib/player/model';
	import type { OwnerTrack } from '$lib/types';
	import TrackPlayButton from './TrackPlayButton.svelte';

	let { track }: { track: OwnerTrack } = $props();
	let playerTrack = $derived(
		toPublicPlayerTrack({
			id: track.publicId,
			title: track.title,
			artist: track.artist
		})
	);
</script>

<article class="owner-track-card">
	<header>
		<div class="owner-track-card__heading">
			<p>{track.artist}</p>
			<span class:private={track.visibility === 'private'}>
				{track.visibility === 'public' ? 'Public' : 'Private'}
			</span>
		</div>
		<h2>{track.title}</h2>
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

	<p class="owner-track-card__date">
		Uploaded <time datetime={track.createdAt}>{formatDate(track.createdAt)}</time>
	</p>

	<footer>
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
		background: var(--surface);
		box-shadow: 0 1rem 3rem rgb(24 32 51 / 6%);
	}

	.owner-track-card__heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.owner-track-card__heading p {
		margin: 0;
		color: var(--accent);
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		overflow-wrap: anywhere;
	}

	.owner-track-card__heading span {
		flex: 0 0 auto;
		padding: 0.28rem 0.55rem;
		color: #17633d;
		border: 1px solid #a9dec2;
		border-radius: 999px;
		background: #edf9f2;
		font-size: 0.72rem;
		font-weight: 800;
	}

	.owner-track-card__heading span.private {
		color: #6d5211;
		border-color: #ead49e;
		background: #fff9e8;
	}

	h2 {
		margin: 0.5rem 0 0;
		font-size: 1.35rem;
		line-height: 1.2;
		letter-spacing: -0.025em;
		overflow-wrap: anywhere;
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
		background: var(--surface-muted);
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
		color: var(--accent-strong);
		border: 1px solid #c9c4fa;
		border-radius: 0.55rem;
		font-size: 0.82rem;
		font-weight: 750;
		text-decoration: none;
	}

	footer a:hover {
		background: #f3f1ff;
	}

	footer .delete-link {
		color: #a72d43;
		border-color: #efbdc6;
	}

	footer .delete-link:hover {
		background: #fff1f3;
	}

	@media (max-width: 28rem) {
		dl {
			grid-template-columns: 1fr;
		}
	}
</style>

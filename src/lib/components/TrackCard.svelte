<script lang="ts">
	import { formatDate } from '$lib/formatting';
	import type { PublicTrack } from '$lib/types';

	let { track }: { track: PublicTrack } = $props();
</script>

<article class="track-card">
	<header>
		<p class="track-card__artist">{track.artist}</p>
		<h2><a href={`/tracks/${track.id}`}>{track.title}</a></h2>
	</header>

	<dl class="track-card__metadata">
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
		<p>
			Uploaded by <strong>{track.ownerUsername}</strong>
		</p>
		<time datetime={track.createdAt}>{formatDate(track.createdAt)}</time>
	</footer>
</article>

<style>
	.track-card {
		display: grid;
		gap: 1.5rem;
		min-width: 0;
		padding: 1.5rem;
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: var(--surface);
		box-shadow: 0 1rem 3rem rgb(24 32 51 / 6%);
	}

	header {
		min-width: 0;
	}

	.track-card__artist {
		margin: 0 0 0.45rem;
		color: var(--accent);
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		overflow-wrap: anywhere;
	}

	h2 {
		margin: 0;
		font-size: 1.35rem;
		line-height: 1.2;
		letter-spacing: -0.025em;
		overflow-wrap: anywhere;
	}

	h2 a {
		text-decoration: none;
	}

	h2 a:hover {
		color: var(--accent-strong);
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}

	.track-card__metadata {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.75rem;
		margin: 0;
	}

	.track-card__metadata div {
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

	footer {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.5rem 1rem;
		padding-top: 1rem;
		color: var(--text-muted);
		border-top: 1px solid var(--border);
		font-size: 0.82rem;
	}

	footer p {
		margin: 0;
		overflow-wrap: anywhere;
	}

	@media (max-width: 28rem) {
		.track-card__metadata {
			grid-template-columns: 1fr;
		}
	}
</style>

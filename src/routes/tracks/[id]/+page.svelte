<script lang="ts">
	import { AddToPlaylist, TrackCover, TrackPlayButton } from '$lib';
	import { formatDate, formatFileSize } from '$lib/formatting';
	import { toPublicPlayerTrack } from '$lib/player/model';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let playerTrack = $derived(toPublicPlayerTrack(data.track));
</script>

<svelte:head>
	<title>{data.track.title} by {data.track.artist} · Audio Library</title>
	<meta
		name="description"
		content={`Listen to ${data.track.title} by ${data.track.artist} on Audio Library.`}
	/>
</svelte:head>

<section class="track-detail-page">
	<div class="page-container track-detail-page__inner">
		<a class="back-link" href="/tracks">← Back to Browse Tracks</a>

		{#if data.uploaded}
			<div class="form-message form-message--success" role="status">
				Audio track uploaded successfully.
			</div>
		{/if}
		{#if data.playlistNotice}
			<div
				class="form-message"
				class:form-message--success={data.playlistNotice.kind === 'success'}
				class:form-message--error={data.playlistNotice.kind === 'error'}
				role="status"
			>
				{data.playlistNotice.message}
			</div>
		{/if}

		<article class="track-detail">
			<div class="track-detail__hero">
				<TrackCover
					coverImageUrl={data.track.coverImageUrl}
					title={data.track.title}
					variant="detail"
					decorative={false}
					loading="eager"
				/>

				<div class="track-detail__intro">
					<header class="track-detail__header">
						<p class="auth-eyebrow">Public track</p>
						<h1>{data.track.title}</h1>
						<p class="track-detail__artist">by {data.track.artist}</p>
					</header>

					<div class="track-detail__actions">
						<TrackPlayButton track={playerTrack} variant="detail" />
						<AddToPlaylist
							trackId={data.track.id}
							trackTitle={data.track.title}
							choices={data.playlistChoices}
							loginHref={data.loginHref}
						/>
						<a class="primary-button" href={`/api/tracks/${data.track.id}/download`}>
							Download audio
						</a>
						{#if data.canManage}
							<a class="secondary-button" href={`/my-tracks/${data.track.id}/edit`}>
								Edit metadata
							</a>
							<a class="danger-link-button" href={`/my-tracks/${data.track.id}/delete`}>
								Delete track
							</a>
						{/if}
					</div>
				</div>
			</div>

			<dl class="track-detail__metadata">
				<div>
					<dt>BPM</dt>
					<dd>{data.track.bpm ?? 'Not specified'}</dd>
				</div>
				<div>
					<dt>Musical key</dt>
					<dd>{data.track.musicalKey ?? 'Not specified'}</dd>
				</div>
				<div>
					<dt>Genre</dt>
					<dd>{data.track.genre ?? 'Not specified'}</dd>
				</div>
				<div>
					<dt>File size</dt>
					<dd>{formatFileSize(data.track.fileSizeBytes)}</dd>
				</div>
				<div>
					<dt>Uploaded by</dt>
					<dd>{data.track.ownerUsername}</dd>
				</div>
				<div>
					<dt>Uploaded</dt>
					<dd><time datetime={data.track.createdAt}>{formatDate(data.track.createdAt)}</time></dd>
				</div>
				<div>
					<dt>Last updated</dt>
					<dd><time datetime={data.track.updatedAt}>{formatDate(data.track.updatedAt)}</time></dd>
				</div>
			</dl>

			<section class="track-description" aria-labelledby="track-description-title">
				<h2 id="track-description-title">Description</h2>
				<p>{data.track.description ?? 'No description provided.'}</p>
			</section>
		</article>
	</div>
</section>

<style>
	.track-detail-page__inner {
		max-width: 76rem;
	}

	.track-detail {
		position: relative;
		overflow: hidden;
		background: var(--detail-background);
	}

	.track-detail__hero {
		display: grid;
		grid-template-columns: minmax(13rem, 18rem) minmax(0, 1fr);
		align-items: center;
		gap: clamp(1.5rem, 4vw, 3.5rem);
	}

	.track-detail__intro {
		display: grid;
		align-content: center;
		gap: 1.75rem;
		min-width: 0;
	}

	.track-detail__header h1 {
		max-width: 18ch;
		font-size: clamp(2.5rem, 5vw, 4.5rem);
		text-wrap: balance;
	}

	.track-detail__artist {
		color: var(--text-muted);
	}

	.track-detail__actions {
		gap: 0.65rem;
	}

	.track-detail__metadata {
		border-color: var(--border);
		background: var(--surface-translucent);
	}

	.track-detail__metadata div {
		border-color: var(--border);
	}

	.track-description {
		padding: 1.25rem;
		border: 1px solid var(--border);
		border-radius: 0.85rem;
		background: var(--detail-section-bg);
	}

	@media (max-width: 48rem) {
		.track-detail__hero {
			grid-template-columns: minmax(0, 1fr);
		}

		.track-detail__hero > :global(.track-cover) {
			width: min(100%, 15rem);
		}
	}

	@media (max-width: 32rem) {
		.track-detail__actions,
		.track-detail__actions :global(a),
		.track-detail__actions :global(button) {
			width: 100%;
		}
	}
</style>

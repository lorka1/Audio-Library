<script lang="ts">
	import { AudioPlayer } from '$lib';
	import { formatDate, formatFileSize } from '$lib/formatting';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
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

		<article class="track-detail">
			<header class="track-detail__header">
				<p class="auth-eyebrow">Public track</p>
				<h1>{data.track.title}</h1>
				<p class="track-detail__artist">by {data.track.artist}</p>
			</header>

			<AudioPlayer trackId={data.track.id} title={data.track.title} />

			<div class="track-detail__actions">
				<a class="primary-button" href={`/api/tracks/${data.track.id}/download`}>
					Download audio
				</a>
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

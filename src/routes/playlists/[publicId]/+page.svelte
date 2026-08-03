<script lang="ts">
	import { PlaylistArtwork, PlaylistImageField, TrackCover, TrackPlayButton } from '$lib';
	import { formatDate } from '$lib/formatting';
	import { toPublicPlayerTrack } from '$lib/player/model';
	import type { PlaylistFormErrors } from '$lib/server/playlists/validation';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let updateValues = $derived(form?.action === 'update' ? form.values : {
		name: data.playlist.name,
		description: data.playlist.description ?? '',
		removeImage: false
	});
	let updateErrors: PlaylistFormErrors = $derived(form?.action === 'update' ? form.errors : {});
</script>

<svelte:head>
	<title>{data.playlist.name} · Audio Library</title>
	<meta name="description" content="Manage tracks in a private Audio Library playlist." />
</svelte:head>

<section class="playlist-detail-page">
	<div class="page-container playlist-detail-page__inner">
		<a class="back-link" href="/playlists">← Back to My Playlists</a>

		{#if data.updated}<div class="form-message form-message--success" role="status">Playlist details updated.</div>{/if}
		{#if data.playlistNotice}
			<div class="form-message" class:form-message--success={data.playlistNotice.kind === 'success'} class:form-message--error={data.playlistNotice.kind === 'error'} role="status">
				{data.playlistNotice.message}
			</div>
		{/if}

		<header class="playlist-detail-heading">
			<PlaylistArtwork imageUrl={data.playlist.imageUrl} name={data.playlist.name} variant="detail" decorative={false} />
			<div>
				<p class="auth-eyebrow">Private playlist</p>
				<h1>{data.playlist.name}</h1>
				<p>{data.playlist.description ?? 'No description provided.'}</p>
				<span>{data.playlist.trackCount} {data.playlist.trackCount === 1 ? 'track' : 'tracks'} · Updated <time datetime={data.playlist.updatedAt}>{formatDate(data.playlist.updatedAt)}</time></span>
			</div>
		</header>

		{#if data.playlist.unavailableTrackCount > 0}
			<div class="playlist-unavailable" role="status">
				{data.playlist.unavailableTrackCount} {data.playlist.unavailableTrackCount === 1 ? 'track is' : 'tracks are'} unavailable and hidden.
			</div>
		{/if}

		<div class="playlist-detail-layout">
			<section class="playlist-tracks" aria-labelledby="playlist-tracks-heading">
				<h2 id="playlist-tracks-heading">Tracks</h2>
				{#if data.playlist.tracks.length > 0}
					<ul>
						{#each data.playlist.tracks as entry (entry.id)}
							<li>
								<TrackCover coverImageUrl={entry.coverImageUrl} title={entry.title} variant="row" />
								<div class="playlist-track__identity">
									<strong title={entry.title}>{entry.title}</strong>
									<span>{entry.artist} · {entry.visibility === 'public' ? 'Public' : 'Your private track'}</span>
								</div>
								{#if entry.visibility === 'public'}
									<TrackPlayButton track={toPublicPlayerTrack({ id: entry.id, title: entry.title, artist: entry.artist, coverImageUrl: entry.coverImageUrl })} variant="icon" />
								{/if}
								<form method="POST" action="?/removeFromPlaylist">
									<input type="hidden" name="trackPublicId" value={entry.id} />
									<input type="hidden" name="playlistPublicId" value={data.playlist.publicId} />
									<button type="submit" aria-label={`Remove ${entry.title} from ${data.playlist.name}`}>Remove</button>
								</form>
							</li>
						{/each}
					</ul>
				{:else}
					<div class="tracks-empty"><p>Add tracks from Browse or My Tracks.</p></div>
				{/if}
			</section>

			<aside class="playlist-settings" aria-labelledby="playlist-settings-heading">
				<h2 id="playlist-settings-heading">Playlist settings</h2>
				{#if updateErrors.general}<div class="form-message form-message--error" role="alert">{updateErrors.general}</div>{/if}
				<form class="form-stack" method="POST" action="?/update" enctype="multipart/form-data">
					<div class="form-field">
						<label for="playlist-edit-name">Name</label>
						<input id="playlist-edit-name" name="name" value={updateValues.name} maxlength="80" required aria-invalid={updateErrors.name ? 'true' : undefined} aria-describedby={updateErrors.name ? 'playlist-edit-name-error' : undefined} />
						{#if updateErrors.name}<p id="playlist-edit-name-error" class="field-error">{updateErrors.name}</p>{/if}
					</div>
					<div class="form-field">
						<label for="playlist-edit-description">Description <span class="optional-label">Optional</span></label>
						<textarea id="playlist-edit-description" name="description" maxlength="500" aria-invalid={updateErrors.description ? 'true' : undefined} aria-describedby={updateErrors.description ? 'playlist-edit-description-error' : undefined}>{updateValues.description}</textarea>
						{#if updateErrors.description}<p id="playlist-edit-description-error" class="field-error">{updateErrors.description}</p>{/if}
					</div>
					<PlaylistImageField id="playlist-edit-image" maxSizeMb={data.maxPlaylistImageSizeMb} currentImageUrl={data.playlist.imageUrl} error={updateErrors.image} removeRequested={updateValues.removeImage} allowRemoval playlistName={updateValues.name || data.playlist.name} />
					<button class="primary-button" type="submit">Save changes</button>
				</form>

				<div class="playlist-delete">
					<h3>Delete playlist</h3>
					<p>This removes the playlist and its memberships. It does not delete any audio track.</p>
					{#if form?.action === 'delete' && form.deleteError}<p class="field-error" role="alert">{form.deleteError}</p>{/if}
					<form method="POST" action="?/delete">
						<label><input type="checkbox" name="confirmDelete" value="delete" required /> I understand this playlist will be deleted.</label>
						<button class="danger-link-button" type="submit">Delete playlist</button>
					</form>
				</div>
			</aside>
		</div>
	</div>
</section>

<style>
	.playlist-detail-page { padding-block: clamp(3rem, 8vw, 6rem); }
	.playlist-detail-page__inner { max-width: 82rem; }
	.playlist-detail-heading { display: grid; grid-template-columns: clamp(7rem, 16vw, 11rem) minmax(0, 1fr); gap: clamp(1.25rem, 4vw, 2.5rem); align-items: center; margin-bottom: 2rem; }
	.playlist-detail-heading h1 { max-width: 22ch; margin: 0; font-size: clamp(2.35rem, 7vw, 4.5rem); line-height: 1; letter-spacing: -0.05em; overflow-wrap: anywhere; }
	.playlist-detail-heading p:not(.auth-eyebrow) { margin: 0.8rem 0 0; color: var(--text-muted); line-height: 1.6; white-space: pre-wrap; }
	.playlist-detail-heading span { display: block; margin-top: 0.75rem; color: var(--text-subtle); font-size: 0.8rem; }
	.playlist-unavailable { margin-bottom: 1rem; padding: 0.8rem 1rem; color: var(--warning); border: 1px solid var(--warning-border); border-radius: 0.7rem; background: var(--warning-bg); }
	.playlist-detail-layout { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(18rem, 0.7fr); gap: 1.5rem; align-items: start; }
	.playlist-tracks, .playlist-settings { min-width: 0; padding: clamp(1.1rem, 3vw, 1.75rem); border: 1px solid var(--border); border-radius: 1rem; background: var(--card-background); }
	.playlist-tracks h2, .playlist-settings h2 { margin: 0 0 1rem; font-size: 1.3rem; }
	.playlist-tracks ul { display: grid; gap: 0.65rem; margin: 0; padding: 0; list-style: none; }
	.playlist-tracks li { display: grid; grid-template-columns: 3.5rem minmax(0, 1fr) auto auto; gap: 0.75rem; align-items: center; min-width: 0; padding: 0.65rem; border: 1px solid var(--border); border-radius: 0.75rem; background: var(--surface-translucent); }
	.playlist-track__identity { display: grid; min-width: 0; gap: 0.25rem; }
	.playlist-track__identity strong, .playlist-track__identity span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.playlist-track__identity span { color: var(--text-muted); font-size: 0.78rem; }
	.playlist-tracks form { margin: 0; }
	.playlist-tracks form button { padding: 0.55rem 0.7rem; color: var(--error); border: 1px solid var(--error-border); border-radius: 0.55rem; background: var(--error-bg); font-weight: 750; cursor: pointer; }
	.playlist-settings textarea { min-height: 7rem; }
	.playlist-delete { margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border); }
	.playlist-delete h3 { margin: 0; font-size: 1rem; }
	.playlist-delete > p { margin: 0.55rem 0 1rem; color: var(--text-muted); font-size: 0.85rem; line-height: 1.5; }
	.playlist-delete form { display: grid; gap: 1rem; }
	.playlist-delete label { display: flex; align-items: flex-start; gap: 0.55rem; color: var(--text-muted); font-size: 0.82rem; line-height: 1.45; }
	.playlist-delete input { margin-top: 0.2rem; accent-color: var(--accent); }
	@media (max-width: 62rem) { .playlist-detail-layout { grid-template-columns: 1fr; } }
	@media (max-width: 36rem) { .playlist-detail-heading { grid-template-columns: 1fr; } .playlist-detail-heading :global(.playlist-artwork) { width: 8rem; } .playlist-tracks li { grid-template-columns: 3.5rem minmax(0, 1fr) auto; } .playlist-tracks li > :global(button) { grid-column: 3; } .playlist-tracks form { grid-column: 2 / -1; } .playlist-tracks form button { width: 100%; } }
</style>

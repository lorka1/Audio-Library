<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatDate } from '$lib/formatting';
	import { PlaylistArtwork, PlaylistImageField } from '$lib';
	import type { PlaylistFormErrors } from '$lib/server/playlists/validation';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let createValues = $derived(form?.action === 'create' ? form.values : { name: '', description: '', removeImage: false });
	let createErrors: PlaylistFormErrors = $derived(form?.action === 'create' ? form.errors : {});
</script>

<svelte:head>
	<title>My Playlists · Audio Library</title>
	<meta name="description" content="Create and manage private playlists for tracks you can access." />
</svelte:head>

<section class="playlists-page">
	<div class="page-container playlists-page__inner">
		<header class="playlists-heading">
			<div>
				<p class="auth-eyebrow">Owner-only collections</p>
				<h1>My Playlists</h1>
				<p>Create private collections of public tracks and your own private uploads.</p>
			</div>
		</header>

		{#if data.created}
			<div class="form-message form-message--success" role="status">Playlist created successfully.</div>
		{/if}
		{#if data.deleted}
			<div class="form-message form-message--success" role="status">Playlist deleted successfully.</div>
		{/if}

		<div class="playlists-layout">
			<section class="playlist-create" aria-labelledby="create-playlist-heading">
				<h2 id="create-playlist-heading">Create playlist</h2>
				<p>Playlist names can be reused. Every playlist is private in this phase.</p>
				{#if createErrors.general}
					<div class="form-message form-message--error" role="alert">{createErrors.general}</div>
				{/if}
				<form class="form-stack" method="POST" action="?/create" enctype="multipart/form-data" use:enhance>
					<div class="form-field">
						<label for="playlist-name">Name</label>
						<input
							id="playlist-name"
							name="name"
							value={createValues.name}
							maxlength="80"
							required
							aria-invalid={createErrors.name ? 'true' : undefined}
							aria-describedby={createErrors.name ? 'playlist-name-error' : undefined}
						/>
						{#if createErrors.name}<p id="playlist-name-error" class="field-error">{createErrors.name}</p>{/if}
					</div>
					<div class="form-field">
						<label for="playlist-description">Description <span class="optional-label">Optional</span></label>
						<textarea
							id="playlist-description"
							name="description"
							maxlength="500"
							aria-invalid={createErrors.description ? 'true' : undefined}
							aria-describedby={createErrors.description ? 'playlist-description-error' : undefined}
						>{createValues.description}</textarea>
						{#if createErrors.description}<p id="playlist-description-error" class="field-error">{createErrors.description}</p>{/if}
					</div>
					<PlaylistImageField maxSizeMb={data.maxPlaylistImageSizeMb} error={createErrors.image} playlistName={createValues.name || 'New playlist'} />
					<button class="primary-button" type="submit">Create playlist</button>
				</form>
			</section>

			<section class="playlist-library" aria-labelledby="playlist-library-heading">
				<div class="playlist-library__heading">
					<h2 id="playlist-library-heading">Your playlists</h2>
					<p>{data.playlists.length} {data.playlists.length === 1 ? 'playlist' : 'playlists'}</p>
				</div>
				{#if data.playlists.length > 0}
					<div class="playlist-grid">
						{#each data.playlists as playlist (playlist.publicId)}
							<a class="playlist-card" href={`/playlists/${playlist.publicId}`}>
								<PlaylistArtwork imageUrl={playlist.imageUrl} name={playlist.name} variant="card" />
								<span class="playlist-card__content">
									<strong title={playlist.name}>{playlist.name}</strong>
									<span class="playlist-card__description">{playlist.description ?? 'No description'}</span>
									<span class="playlist-card__meta">
										{playlist.trackCount} {playlist.trackCount === 1 ? 'track' : 'tracks'} · Updated
										<time datetime={playlist.updatedAt}>{formatDate(playlist.updatedAt)}</time>
									</span>
								</span>
							</a>
						{/each}
					</div>
				{:else}
					<div class="tracks-empty playlist-empty">
						<span aria-hidden="true">♫</span>
						<p>Your first private playlist will appear here.</p>
					</div>
				{/if}
			</section>
		</div>
	</div>
</section>

<style>
	.playlists-page { padding-block: clamp(3rem, 8vw, 6rem); }
	.playlists-page__inner { max-width: 78rem; }
	.playlists-heading { margin-bottom: 2rem; }
	.playlists-heading h1 { margin: 0; font-size: clamp(2.4rem, 7vw, 4.2rem); line-height: 1; letter-spacing: -0.05em; }
	.playlists-heading p:last-child { max-width: 44rem; margin: 1rem 0 0; color: var(--text-muted); line-height: 1.65; }
	.playlists-layout { display: grid; grid-template-columns: minmax(18rem, 0.72fr) minmax(0, 1.28fr); gap: 1.5rem; align-items: start; }
	.playlist-create, .playlist-library { min-width: 0; padding: clamp(1.25rem, 4vw, 2rem); border: 1px solid var(--border); border-radius: 1.1rem; background: var(--card-background); box-shadow: var(--shadow-card); }
	.playlist-create h2, .playlist-library h2 { margin: 0; font-size: 1.35rem; }
	.playlist-create > p { margin: 0.65rem 0 1.4rem; color: var(--text-muted); line-height: 1.55; }
	.playlist-create textarea { min-height: 7rem; }
	.playlist-library__heading { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; margin-bottom: 1rem; }
	.playlist-library__heading p { margin: 0; color: var(--text-muted); font-size: 0.85rem; }
	.playlist-grid { display: grid; gap: 0.75rem; }
	.playlist-card { display: grid; grid-template-columns: 3.25rem minmax(0, 1fr); gap: 0.9rem; align-items: center; min-width: 0; padding: 0.9rem; border: 1px solid var(--border); border-radius: 0.8rem; background: var(--surface-translucent); text-decoration: none; }
	.playlist-card:hover { border-color: var(--accent-border); background: var(--accent-soft); }
	.playlist-card__content { display: grid; min-width: 0; gap: 0.25rem; }
	.playlist-card strong, .playlist-card__description, .playlist-card__meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.playlist-card strong { font-size: 1rem; }
	.playlist-card__description { color: var(--text-muted); font-size: 0.82rem; }
	.playlist-card__meta { color: var(--text-subtle); font-size: 0.73rem; }
	.playlist-empty { display: grid; justify-items: center; gap: 0.75rem; }
	.playlist-empty span { color: var(--link); font-size: 2rem; }
	@media (max-width: 58rem) { .playlists-layout { grid-template-columns: 1fr; } }
</style>

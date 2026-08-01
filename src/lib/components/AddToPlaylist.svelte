<script lang="ts">
	import type { PlaylistPickerEntry } from '$lib/types';

	let {
		trackId,
		trackTitle,
		choices,
		loginHref
	}: {
		trackId: number;
		trackTitle: string;
		choices: PlaylistPickerEntry[] | null;
		loginHref: string;
	} = $props();

	let dialog = $state<HTMLDialogElement>();
	let trigger = $state<HTMLButtonElement>();
	let titleId = $derived(`playlist-dialog-title-${trackId}`);

	function openDialog(): void {
		dialog?.showModal();
	}

	function closeDialog(): void {
		dialog?.close();
		trigger?.focus();
	}
</script>

{#if choices === null}
	<a class="playlist-login-link" href={loginHref}>Log in to add to a playlist</a>
{:else}
	<button
		bind:this={trigger}
		class="playlist-trigger"
		type="button"
		onclick={openDialog}
		aria-haspopup="dialog"
	>
		Add to playlist
	</button>

	<dialog bind:this={dialog} class="playlist-dialog" aria-labelledby={titleId} onclose={() => trigger?.focus()}>
		<div class="playlist-dialog__header">
			<div>
				<p class="auth-eyebrow">Private playlists</p>
				<h2 id={titleId}>Add “{trackTitle}”</h2>
			</div>
			<button type="button" class="playlist-dialog__close" onclick={closeDialog} aria-label="Close add to playlist dialog">×</button>
		</div>

		{#if choices.length > 0}
			<ul class="playlist-dialog__list">
				{#each choices as playlist (playlist.publicId)}
					<li>
						<span title={playlist.name}>{playlist.name}</span>
						<form method="POST" action={playlist.containsTrack ? '?/removeFromPlaylist' : '?/addToPlaylist'}>
							<input type="hidden" name="trackPublicId" value={trackId} />
							<input type="hidden" name="playlistPublicId" value={playlist.publicId} />
							<button type="submit" class:remove={playlist.containsTrack}>
								{playlist.containsTrack ? 'Remove' : 'Add'}
							</button>
						</form>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="playlist-dialog__empty">You do not have a playlist yet.</p>
		{/if}

		<a class="playlist-dialog__manage" href="/playlists">Create or manage playlists</a>
	</dialog>
{/if}

<style>
	.playlist-trigger,
	.playlist-login-link {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.75rem;
		padding: 0.6rem 0.8rem;
		color: #d8d2ff;
		border: 1px solid rgb(154 132 255 / 34%);
		border-radius: 0.6rem;
		background: rgb(104 71 245 / 11%);
		font-size: 0.82rem;
		font-weight: 750;
		text-decoration: none;
		cursor: pointer;
	}

	.playlist-trigger:hover,
	.playlist-login-link:hover {
		background: rgb(104 71 245 / 20%);
	}

	.playlist-dialog {
		width: min(32rem, calc(100vw - 2rem));
		max-height: min(38rem, calc(100dvh - 2rem));
		padding: 1.25rem;
		overflow: auto;
		color: var(--text);
		border: 1px solid rgb(151 129 255 / 32%);
		border-radius: 1rem;
		background: #10172b;
		box-shadow: 0 1.5rem 4rem rgb(0 2 14 / 58%);
	}

	.playlist-dialog::backdrop {
		background: rgb(1 4 14 / 76%);
		backdrop-filter: blur(0.2rem);
	}

	.playlist-dialog__header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--border);
	}

	.playlist-dialog h2 {
		margin: 0;
		font-size: 1.25rem;
		line-height: 1.25;
		overflow-wrap: anywhere;
	}

	.playlist-dialog__close {
		display: grid;
		place-items: center;
		flex: 0 0 auto;
		width: 2.5rem;
		height: 2.5rem;
		padding: 0;
		color: var(--text-muted);
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface-muted);
		font-size: 1.4rem;
		cursor: pointer;
	}

	.playlist-dialog__list {
		display: grid;
		gap: 0.5rem;
		margin: 1rem 0;
		padding: 0;
		list-style: none;
	}

	.playlist-dialog__list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		min-width: 0;
		padding: 0.65rem;
		border: 1px solid var(--border);
		border-radius: 0.7rem;
		background: rgb(7 12 29 / 58%);
	}

	.playlist-dialog__list span {
		overflow: hidden;
		font-weight: 700;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.playlist-dialog__list form {
		flex: 0 0 auto;
		margin: 0;
	}

	.playlist-dialog__list button {
		min-width: 5rem;
		padding: 0.55rem 0.7rem;
		color: white;
		border: 1px solid rgb(154 132 255 / 34%);
		border-radius: 0.55rem;
		background: var(--accent);
		font-weight: 750;
		cursor: pointer;
	}

	.playlist-dialog__list button.remove {
		color: #ffc4ce;
		border-color: rgb(222 89 112 / 36%);
		background: rgb(116 30 49 / 20%);
	}

	.playlist-dialog__empty {
		margin: 1rem 0;
		color: var(--text-muted);
	}

	.playlist-dialog__manage {
		display: inline-flex;
		color: #b6a8ff;
		font-weight: 750;
		text-underline-offset: 0.2em;
	}

	@media (max-width: 28rem) {
		.playlist-dialog__list li {
			align-items: stretch;
			flex-direction: column;
		}

		.playlist-dialog__list button {
			width: 100%;
		}
	}
</style>

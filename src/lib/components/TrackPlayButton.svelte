<script lang="ts">
	import type { AudioPlayerController } from '$lib/player/controller';
	import type { PublicPlayerTrack } from '$lib/player/model';
	import { useAudioPlayer } from '$lib/player/context';

	let {
		track,
		player = useAudioPlayer(),
		variant = 'compact'
	}: {
		track: PublicPlayerTrack;
		player?: AudioPlayerController;
		variant?: 'compact' | 'detail' | 'icon';
	} = $props();

	let state = $derived($player);
	let isSelected = $derived(state.track?.id === track.id);
	let isLoading = $derived(isSelected && state.status === 'loading');
	let isPlaying = $derived(isSelected && state.status === 'playing');
	let hasError = $derived(isSelected && state.status === 'error');
	let label = $derived(
		hasError
			? `Retry ${track.title}`
			: isPlaying || isLoading
				? `Pause ${track.title}`
				: isSelected
					? `Resume ${track.title}`
					: `Play ${track.title}`
	);
	let visibleStatus = $derived(
		hasError
			? 'Unavailable'
			: isLoading
				? 'Loading'
				: isPlaying
					? 'Playing'
					: isSelected
						? 'Paused'
						: 'Play'
	);
</script>

<button
	type="button"
	class="track-play-button"
	class:track-play-button--compact={variant === 'compact'}
	class:track-play-button--detail={variant === 'detail'}
	class:track-play-button--icon={variant === 'icon'}
	class:selected={isSelected}
	class:playing={isPlaying}
	class:loading={isLoading}
	class:error={hasError}
	aria-label={label}
	aria-pressed={isSelected && state.wantsToPlay}
	onclick={() => player.toggleTrack(track)}
>
	<span class="track-play-button__icon" aria-hidden="true">
		{#if isLoading}
			<span class="track-play-button__spinner"></span>
		{:else if isPlaying}
			<svg viewBox="0 0 24 24" focusable="false">
				<path d="M7 5h4v14H7zM13 5h4v14h-4z"></path>
			</svg>
		{:else if hasError}
			<svg viewBox="0 0 24 24" focusable="false">
				<path d="M11 6h2v8h-2zm0 10h2v2h-2z"></path>
			</svg>
		{:else}
			<svg viewBox="0 0 24 24" focusable="false">
				<path d="m8 5 11 7-11 7z"></path>
			</svg>
		{/if}
	</span>
	<span class:visually-hidden={variant === 'icon'}>{visibleStatus}</span>
</button>

<style>
	button {
		display: inline-flex;
		flex: 0 0 auto;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		min-height: 2.75rem;
		padding: 0.55rem 0.7rem;
		color: var(--link);
		border: 1px solid var(--accent-border);
		border-radius: 0.65rem;
		background: var(--accent-soft);
		font-size: 0.78rem;
		font-weight: 800;
		cursor: pointer;
		transition:
			background-color 150ms ease,
			border-color 150ms ease,
			color 150ms ease;
	}

	button:hover {
		border-color: var(--accent-border);
		background: color-mix(in srgb, var(--accent) 22%, transparent);
	}

	button.selected {
		color: var(--on-accent);
		border-color: var(--accent-strong);
		background: color-mix(in srgb, var(--accent) 30%, transparent);
	}

	button.playing {
		color: var(--on-accent);
		border-color: var(--accent-strong);
		background: var(--accent);
		box-shadow: var(--shadow-accent-soft);
	}

	button.error {
		color: var(--error);
		border-color: var(--error-border);
		background: var(--error-bg);
	}

	button.track-play-button--detail {
		min-height: 3rem;
		padding-inline: 1rem;
		font-size: 0.9rem;
	}

	button.track-play-button--icon {
		width: 2.75rem;
		height: 2.75rem;
		min-height: 2.75rem;
		padding: 0;
		color: var(--player-text);
		border-color: var(--player-control-border);
		border-radius: 999px;
		background: var(--player-control-bg);
	}

	button.track-play-button--icon:hover,
	button.track-play-button--icon.selected {
		border-color: var(--accent-strong);
		background: color-mix(in srgb, var(--accent) 25%, transparent);
	}

	button.track-play-button--icon.playing {
		background: var(--accent);
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.track-play-button__icon {
		display: inline-grid;
		flex: 0 0 auto;
		place-items: center;
		width: 1rem;
		height: 1rem;
	}

	svg {
		width: 1rem;
		height: 1rem;
		fill: currentColor;
	}

	.track-play-button__spinner {
		width: 0.9rem;
		height: 0.9rem;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 999px;
		animation: spin 800ms linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(1turn);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.track-play-button__spinner {
			animation: none;
			border-right-color: currentColor;
		}
	}
</style>

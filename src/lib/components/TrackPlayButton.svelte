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
		color: #cfc6ff;
		border: 1px solid rgb(154 132 255 / 35%);
		border-radius: 0.65rem;
		background: rgb(104 71 245 / 12%);
		font-size: 0.78rem;
		font-weight: 800;
		cursor: pointer;
		transition:
			background-color 150ms ease,
			border-color 150ms ease,
			color 150ms ease;
	}

	button:hover {
		border-color: rgb(164 142 255 / 58%);
		background: rgb(104 71 245 / 22%);
	}

	button.selected {
		color: white;
		border-color: #8e75ff;
		background: rgb(104 71 245 / 30%);
	}

	button.playing {
		color: white;
		border-color: #8a6fff;
		background: #6847f5;
		box-shadow: 0 0 1.2rem rgb(104 71 245 / 28%);
	}

	button.error {
		color: #ffc4ce;
		border-color: rgb(222 89 112 / 44%);
		background: rgb(116 30 49 / 24%);
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
		color: #f6f4ff;
		border-color: rgb(209 213 231 / 54%);
		border-radius: 999px;
		background: rgb(8 14 33 / 68%);
	}

	button.track-play-button--icon:hover,
	button.track-play-button--icon.selected {
		border-color: #8f76ff;
		background: rgb(104 71 245 / 25%);
	}

	button.track-play-button--icon.playing {
		background: #6847f5;
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

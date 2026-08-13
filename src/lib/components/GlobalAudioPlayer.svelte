<script lang="ts">
	import type { AudioPlayerController } from '$lib/player/controller';
	import { formatPlaybackTime } from '$lib/player/model';
	import TrackCover from './TrackCover.svelte';

	let { player }: { player: AudioPlayerController } = $props();

	let state = $derived($player);
	let toggleLabel = $derived(
		state.track
			? state.status === 'error'
				? `Retry ${state.track.title}`
				: state.wantsToPlay
					? `Pause ${state.track.title}`
					: state.currentTime > 0
						? `Resume ${state.track.title}`
						: `Play ${state.track.title}`
			: 'Play'
	);
	let progressPercentage = $derived(
		state.duration > 0
			? Math.min(100, Math.max(0, (state.currentTime / state.duration) * 100))
			: 0
	);
	let audio: HTMLAudioElement;
	let handledRequestVersion = -1;

	$effect(() => {
		const track = state.track;
		const requestVersion = state.requestVersion;

		if (!audio || !track || requestVersion === handledRequestVersion) return;
		handledRequestVersion = requestVersion;

		if (state.wantsToPlay) {
			if (state.duration > 0 && audio.currentTime >= state.duration) {
				audio.currentTime = 0;
				player.setCurrentTime(0);
			}
			player.markLoading();
			void audio.play().catch(() => player.markError());
		} else {
			audio.pause();
		}
	});

	function seek(event: Event): void {
		const target = event.currentTarget as HTMLInputElement;
		const nextTime = Number(target.value);

		if (!Number.isFinite(nextTime)) return;
		audio.currentTime = nextTime;
		player.setCurrentTime(nextTime);
	}

	function changeVolume(event: Event): void {
		const target = event.currentTarget as HTMLInputElement;
		const nextVolume = Number(target.value);

		if (!Number.isFinite(nextVolume)) return;
		audio.volume = nextVolume;
		player.setVolume(nextVolume);
	}
</script>

<audio
	bind:this={audio}
	src={state.track?.streamUrl}
	preload="metadata"
	aria-label={state.track ? `Global audio player for ${state.track.title}` : 'Global audio player'}
	onloadstart={() => state.wantsToPlay && player.markLoading()}
	onwaiting={() => state.wantsToPlay && player.markLoading()}
	onplaying={() => player.markPlaying()}
	onpause={() => player.markPaused()}
	onended={() => player.markEnded()}
	onerror={() => state.track && player.markError()}
	onloadedmetadata={() => {
		player.setDuration(audio.duration);
		audio.volume = state.volume;
	}}
	ontimeupdate={() => player.setCurrentTime(audio.currentTime)}
	onvolumechange={() => player.setVolume(audio.volume)}
></audio>

{#if state.track}
	<aside class="global-player" aria-label="Now playing">
		<div class="global-player__inner">
			<div class="global-player__identity">
				<TrackCover
					coverImageUrl={state.track.coverImageUrl}
					title={state.track.title}
					variant="player"
					loading="eager"
				/>
				<div class="global-player__track-copy">
					<p class="global-player__status">
						{state.status === 'error'
							? 'Playback unavailable'
							: state.status === 'loading'
								? 'Loading'
								: state.status === 'playing'
									? 'Now playing'
									: 'Paused'}
					</p>
					<a href={state.track.detailsUrl}>{state.track.title}</a>
					<p>{state.track.artist}</p>
				</div>
			</div>

			<div class="global-player__playback">
				<button
					class="global-player__toggle"
					type="button"
					aria-label={toggleLabel}
					onclick={() => player.toggleTrack(state.track!)}
				>
					{#if state.wantsToPlay}
						<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
							<path d="M7 5h4v14H7zM13 5h4v14h-4z"></path>
						</svg>
					{:else}
						<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
							<path d="m8 5 11 7-11 7z"></path>
						</svg>
					{/if}
				</button>

				<div class="global-player__timeline">
					<span>{formatPlaybackTime(state.currentTime)}</span>
					<input
						type="range"
						min="0"
						max={state.duration || 0}
						step="0.1"
						value={Math.min(state.currentTime, state.duration || 0)}
						style={`--range-progress: ${progressPercentage}%`}
						disabled={state.duration === 0}
						aria-label={`Seek ${state.track.title}`}
						oninput={seek}
					/>
					<span>{formatPlaybackTime(state.duration)}</span>
				</div>
			</div>

			<label class="global-player__volume">
				<span class="global-player__volume-label">
					<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
						<path d="M4 9v6h4l5 4V5L8 9zm11.5-.5v7a4 4 0 0 0 0-7z"></path>
					</svg>
					<span class="sr-only">Volume</span>
				</span>
				<input
					type="range"
					min="0"
					max="1"
					step="0.05"
					value={state.volume}
					style={`--range-progress: ${state.volume * 100}%`}
					aria-label="Volume"
					oninput={changeVolume}
				/>
			</label>
		</div>

		{#if state.errorMessage}
			<p class="global-player__message" role="status">{state.errorMessage}</p>
		{/if}
	</aside>
{/if}

<style>
	audio {
		position: fixed;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}

	.global-player {
		position: fixed;
		z-index: 30;
		right: 0;
		bottom: 0;
		left: 0;
		width: 100%;
		min-height: var(--player-height);
		padding: 0.65rem max(var(--page-gutter), env(safe-area-inset-right))
			calc(0.65rem + env(safe-area-inset-bottom))
			max(var(--page-gutter), env(safe-area-inset-left));
		color: var(--player-text);
		border-top: 1px solid var(--border-strong);
		background: var(--player-bg);
		box-shadow: var(--shadow-player);
		backdrop-filter: blur(1rem);
	}

	.global-player__inner {
		display: grid;
		grid-template-columns:
			minmax(15rem, 0.9fr) minmax(23rem, 1.7fr)
			minmax(10rem, 0.55fr);
		align-items: center;
		gap: 0;
		width: min(100%, var(--content-width));
		margin-inline: auto;
	}

	.global-player__identity {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		gap: 0.85rem;
		min-width: 0;
		padding-right: 1.35rem;
	}

	.global-player__track-copy {
		min-width: 0;
	}

	.global-player__track-copy a,
	.global-player__track-copy p {
		display: block;
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.global-player__track-copy a {
		font-size: 0.9rem;
		font-weight: 800;
		text-decoration: none;
	}

	.global-player__track-copy a:hover {
		color: var(--link);
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}

	.global-player__track-copy p:last-child {
		margin-top: 0.15rem;
		color: var(--player-muted);
		font-size: 0.75rem;
	}

	.global-player__identity .global-player__status {
		margin-bottom: 0.15rem;
		color: var(--accent-strong);
		font-size: 0.65rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.global-player__playback {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		gap: 1.1rem;
		min-width: 0;
		padding-inline: clamp(1rem, 2.5vw, 2.25rem);
		border-inline: 1px solid var(--border);
	}

	button {
		display: inline-grid;
		place-items: center;
		width: 3.25rem;
		height: 3.25rem;
		padding: 0;
		color: var(--player-text);
		border: 1px solid var(--player-control-border);
		border-radius: 999px;
		background: var(--player-control-bg);
		cursor: pointer;
	}

	button:hover {
		background: var(--player-control-hover);
	}

	.global-player__toggle {
		color: var(--on-accent);
		border: 2px solid var(--accent-strong);
		background: linear-gradient(145deg, var(--accent), var(--accent-burgundy));
		box-shadow:
			0 0 0 0.25rem color-mix(in srgb, var(--accent) 18%, transparent),
			var(--shadow-accent);
	}

	.global-player__toggle:hover {
		background: linear-gradient(145deg, var(--accent-hover), var(--accent-burgundy));
	}

	button svg {
		width: 1.15rem;
		height: 1.15rem;
		fill: currentColor;
	}

	.global-player__timeline {
		display: grid;
		grid-template-columns: 2.9rem minmax(5rem, 1fr) 2.9rem;
		align-items: center;
		gap: 0.5rem;
		color: var(--player-muted);
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
	}

	.global-player__timeline span:last-child {
		text-align: right;
	}

	input[type='range'] {
		appearance: none;
		width: 100%;
		height: 1.25rem;
		min-width: 0;
		margin: 0;
		background: transparent;
		accent-color: var(--accent-strong);
		cursor: pointer;
	}

	input[type='range']::-webkit-slider-runnable-track {
		height: 0.24rem;
		border-radius: 999px;
		background: linear-gradient(
			90deg,
			var(--range-filled) 0 var(--range-progress),
			var(--range-empty) var(--range-progress) 100%
		);
	}

	input[type='range']::-webkit-slider-thumb {
		appearance: none;
		width: 0.85rem;
		height: 0.85rem;
		margin-top: -0.305rem;
		border: 0;
		border-radius: 999px;
		background: var(--range-thumb);
		box-shadow: 0 0 0 0.2rem color-mix(in srgb, var(--accent) 14%, transparent);
	}

	input[type='range']::-moz-range-track {
		height: 0.24rem;
		border-radius: 999px;
		background: var(--range-empty);
	}

	input[type='range']::-moz-range-progress {
		height: 0.24rem;
		border-radius: 999px;
		background: var(--range-filled);
	}

	input[type='range']::-moz-range-thumb {
		width: 0.85rem;
		height: 0.85rem;
		border: 0;
		border-radius: 999px;
		background: var(--range-thumb);
		box-shadow: 0 0 0 0.2rem color-mix(in srgb, var(--accent) 14%, transparent);
	}

	input[type='range']:disabled {
		cursor: wait;
		opacity: 0.55;
	}

	.global-player__volume {
		display: grid;
		grid-template-columns: auto minmax(4rem, 1fr);
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
		padding-left: clamp(1rem, 2.5vw, 2.25rem);
		color: var(--player-muted);
		font-size: 0.65rem;
		font-weight: 700;
	}

	.global-player__volume-label {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}

	.global-player__volume-label svg {
		width: 1.15rem;
		height: 1.15rem;
		fill: currentColor;
	}

	.global-player__message {
		width: min(100%, var(--content-width));
		margin: 0.4rem auto 0;
		color: var(--error);
		font-size: 0.75rem;
		text-align: center;
	}

	@media (max-width: 56.25rem) {
		.global-player__inner {
			grid-template-columns: minmax(12rem, 0.8fr) minmax(20rem, 2fr);
		}

		.global-player__volume {
			display: none;
		}

		.global-player__playback {
			border-right: 0;
		}
	}

	@media (max-width: 43.75rem) {
		.global-player {
			min-height: calc(var(--player-height) + 1.75rem);
			padding-block: 0.65rem calc(0.65rem + env(safe-area-inset-bottom));
		}

		.global-player__inner {
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 0.55rem 0.75rem;
		}

		.global-player__identity {
			grid-column: 1;
			padding-right: 0;
		}

		.global-player__playback {
			display: contents;
			border: 0;
		}

		.global-player__toggle {
			grid-column: 2;
			grid-row: 1;
		}

		.global-player__timeline {
			grid-column: 1 / -1;
			grid-row: 2;
		}
	}

	@media (max-width: 30rem) {
		.global-player__status {
			display: none;
		}

		.global-player__timeline {
			grid-template-columns: 2.5rem minmax(3rem, 1fr) 2.5rem;
			gap: 0.35rem;
		}
	}
</style>

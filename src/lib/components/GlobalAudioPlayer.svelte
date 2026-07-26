<script lang="ts">
	import type { AudioPlayerController } from '$lib/player/controller';
	import { formatPlaybackTime } from '$lib/player/model';

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

	function clearPlayer(): void {
		audio.pause();
		audio.removeAttribute('src');
		audio.load();
		player.clear();
		handledRequestVersion = -1;
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
					disabled={state.duration === 0}
					aria-label={`Seek ${state.track.title}`}
					oninput={seek}
				/>
				<span>{formatPlaybackTime(state.duration)}</span>
			</div>

			<label class="global-player__volume">
				<span>Volume</span>
				<input
					type="range"
					min="0"
					max="1"
					step="0.05"
					value={state.volume}
					aria-label="Volume"
					oninput={changeVolume}
				/>
			</label>

			<button
				class="global-player__close"
				type="button"
				aria-label="Close audio player"
				onclick={clearPlayer}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
					<path d="M6.4 5 5 6.4l5.6 5.6L5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z"></path>
				</svg>
			</button>
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
		padding: 0.75rem max(1rem, env(safe-area-inset-right))
			calc(0.75rem + env(safe-area-inset-bottom))
			max(1rem, env(safe-area-inset-left));
		color: #f9fafb;
		border-top: 1px solid rgb(255 255 255 / 12%);
		background: rgb(17 24 39 / 97%);
		box-shadow: 0 -0.75rem 2.5rem rgb(17 24 39 / 20%);
		backdrop-filter: blur(0.8rem);
	}

	.global-player__inner {
		display: grid;
		grid-template-columns: minmax(10rem, 1.2fr) auto minmax(14rem, 2fr) minmax(7rem, 0.8fr) auto;
		align-items: center;
		gap: 0.75rem 1rem;
		width: min(100%, var(--content-width));
		margin-inline: auto;
	}

	.global-player__identity {
		min-width: 0;
	}

	.global-player__identity a,
	.global-player__identity p {
		display: block;
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.global-player__identity a {
		font-size: 0.9rem;
		font-weight: 800;
		text-decoration: none;
	}

	.global-player__identity a:hover {
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}

	.global-player__identity p:last-child {
		margin-top: 0.15rem;
		color: #aeb8c8;
		font-size: 0.75rem;
	}

	.global-player__identity .global-player__status {
		margin-bottom: 0.15rem;
		color: #a59dff;
		font-size: 0.65rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	button {
		display: inline-grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		padding: 0;
		color: white;
		border: 1px solid rgb(255 255 255 / 16%);
		border-radius: 999px;
		background: rgb(255 255 255 / 8%);
		cursor: pointer;
	}

	button:hover {
		background: rgb(255 255 255 / 14%);
	}

	.global-player__toggle {
		border-color: transparent;
		background: var(--accent);
	}

	.global-player__toggle:hover {
		background: #756af1;
	}

	button svg {
		width: 1.15rem;
		height: 1.15rem;
		fill: currentColor;
	}

	.global-player__timeline {
		display: grid;
		grid-template-columns: 2.8rem minmax(5rem, 1fr) 2.8rem;
		align-items: center;
		gap: 0.5rem;
		color: #cbd5e1;
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
	}

	.global-player__timeline span:last-child {
		text-align: right;
	}

	input[type='range'] {
		width: 100%;
		min-width: 0;
		accent-color: #8f86ff;
		cursor: pointer;
	}

	input[type='range']:disabled {
		cursor: wait;
		opacity: 0.55;
	}

	.global-player__volume {
		display: grid;
		gap: 0.2rem;
		color: #cbd5e1;
		font-size: 0.65rem;
		font-weight: 700;
	}

	.global-player__message {
		width: min(100%, var(--content-width));
		margin: 0.4rem auto 0;
		color: #fecdd3;
		font-size: 0.75rem;
		text-align: center;
	}

	@media (max-width: 48rem) {
		.global-player__inner {
			grid-template-columns: minmax(0, 1fr) auto auto;
		}

		.global-player__identity {
			grid-column: 1;
		}

		.global-player__toggle {
			grid-column: 2;
		}

		.global-player__close {
			grid-column: 3;
		}

		.global-player__timeline {
			grid-column: 1 / -1;
			grid-row: 2;
		}

		.global-player__volume {
			display: none;
		}
	}
</style>

import { get, writable, type Readable } from 'svelte/store';
import type { PublicPlayerTrack } from './model';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface AudioPlayerState {
	track: PublicPlayerTrack | null;
	status: PlayerStatus;
	wantsToPlay: boolean;
	currentTime: number;
	duration: number;
	volume: number;
	errorMessage: string | null;
	requestVersion: number;
}

const initialState: AudioPlayerState = {
	track: null,
	status: 'idle',
	wantsToPlay: false,
	currentTime: 0,
	duration: 0,
	volume: 1,
	errorMessage: null,
	requestVersion: 0
};

export class AudioPlayerController implements Readable<AudioPlayerState> {
	readonly #state = writable<AudioPlayerState>(initialState);
	readonly subscribe = this.#state.subscribe;

	toggleTrack(track: PublicPlayerTrack): void {
		const state = get(this.#state);

		if (state.track?.id !== track.id) {
			this.#state.set({
				...initialState,
				track,
				status: 'loading',
				wantsToPlay: true,
				volume: state.volume,
				requestVersion: state.requestVersion + 1
			});
			return;
		}

		const wantsToPlay = !state.wantsToPlay;
		this.#state.set({
			...state,
			status: wantsToPlay ? 'loading' : 'paused',
			wantsToPlay,
			errorMessage: null,
			requestVersion: state.requestVersion + 1
		});
	}

	markLoading(): void {
		this.#state.update((state) =>
			state.track && state.wantsToPlay
				? { ...state, status: 'loading', errorMessage: null }
				: state
		);
	}

	markPlaying(): void {
		this.#state.update((state) =>
			state.track && state.wantsToPlay
				? { ...state, status: 'playing', errorMessage: null }
				: state
		);
	}

	markPaused(): void {
		this.#state.update((state) =>
			state.track && !state.wantsToPlay ? { ...state, status: 'paused' } : state
		);
	}

	markEnded(): void {
		this.#state.update((state) =>
			state.track
				? {
						...state,
						status: 'paused',
						wantsToPlay: false,
						currentTime: state.duration
					}
				: state
		);
	}

	markError(): void {
		this.#state.update((state) =>
			state.track
				? {
						...state,
						status: 'error',
						wantsToPlay: false,
						errorMessage: 'Playback is unavailable. Try again.'
					}
				: state
		);
	}

	setCurrentTime(currentTime: number): void {
		if (!Number.isFinite(currentTime) || currentTime < 0) return;
		this.#state.update((state) => ({ ...state, currentTime }));
	}

	setDuration(duration: number): void {
		const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
		this.#state.update((state) => ({ ...state, duration: safeDuration }));
	}

	setVolume(volume: number): void {
		if (!Number.isFinite(volume)) return;
		const safeVolume = Math.min(1, Math.max(0, volume));
		this.#state.update((state) => ({ ...state, volume: safeVolume }));
	}

	clear(): void {
		const state = get(this.#state);
		this.#state.set({
			...initialState,
			volume: state.volume,
			requestVersion: state.requestVersion + 1
		});
	}
}

export function createAudioPlayerController(): AudioPlayerController {
	return new AudioPlayerController();
}

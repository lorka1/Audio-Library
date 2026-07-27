import { getContext, setContext } from 'svelte';
import type { AudioPlayerController } from './controller';

const AUDIO_PLAYER_CONTEXT = Symbol('audio-player');

export function provideAudioPlayer(controller: AudioPlayerController): void {
	setContext(AUDIO_PLAYER_CONTEXT, controller);
}

export function useAudioPlayer(): AudioPlayerController {
	return getContext<AudioPlayerController>(AUDIO_PLAYER_CONTEXT);
}

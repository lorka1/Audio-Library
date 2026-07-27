<script lang="ts">
	import {
		createAudioPlayerController,
		GlobalAudioPlayer,
		SiteHeader
	} from '$lib';
	import { provideAudioPlayer } from '$lib/player/context';
	import type { LayoutProps } from './$types';
	import '../app.css';

	let { data, children }: LayoutProps = $props();
	const player = createAudioPlayerController();
	provideAudioPlayer(player);
	let playerState = $derived($player);
</script>

<svelte:head>
	<meta
		name="description"
		content="Upload and manage audio, discover public tracks, and listen or download securely."
	/>
</svelte:head>

<div class:has-global-player={playerState.track !== null} class="site-shell">
	<a class="skip-link" href="#main-content">Skip to main content</a>
	<SiteHeader user={data.user} />

	<main id="main-content" tabindex="-1">
		{@render children()}
	</main>

	<footer class="site-footer">
		<div class="page-container site-footer__inner">
			<p>Audio Library</p>
			<p>Private storage · public discovery · owner controls</p>
		</div>
	</footer>

	<GlobalAudioPlayer {player} />
</div>

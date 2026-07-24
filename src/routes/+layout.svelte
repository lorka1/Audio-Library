<script lang="ts">
	import type { Snippet } from 'svelte';
	import { SiteHeader } from '$lib';
	import '../app.css';

	let { children }: { children: Snippet } = $props();
</script>

<svelte:head>
	<meta
		name="description"
		content="A secure personal library for organizing and playing audio tracks."
	/>
</svelte:head>

<div class="site-shell">
	<SiteHeader />

	<main>
		{@render children()}
	</main>

	<footer class="site-footer">
		<div class="page-container site-footer__inner">
			<p>Audio Library</p>
			<p>Phase 1 · project foundation</p>
		</div>
	</footer>
</div>

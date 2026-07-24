<script lang="ts">
	import { SiteHeader } from '$lib';
	import type { LayoutProps } from './$types';
	import '../app.css';

	let { data, children }: LayoutProps = $props();
</script>

<svelte:head>
	<meta
		name="description"
		content="A secure personal library for organizing and playing audio tracks."
	/>
</svelte:head>

<div class="site-shell">
	<SiteHeader user={data.user} />

	<main>
		{@render children()}
	</main>

	<footer class="site-footer">
		<div class="page-container site-footer__inner">
			<p>Audio Library</p>
			<p>Phase 2 · secure authentication</p>
		</div>
	</footer>
</div>

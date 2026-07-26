<script lang="ts">
	import { SiteHeader } from '$lib';
	import type { LayoutProps } from './$types';
	import '../app.css';

	let { data, children }: LayoutProps = $props();
</script>

<svelte:head>
	<meta
		name="description"
		content="A secure personal library for uploading audio tracks and organizing their metadata."
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
			<p>Phase 6 · owner-managed metadata and safe track deletion</p>
		</div>
	</footer>
</div>

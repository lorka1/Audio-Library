<script lang="ts">
	let {
		imageUrl,
		name,
		variant = 'card',
		decorative = true
	}: {
		imageUrl: string | null;
		name: string;
		variant?: 'card' | 'detail' | 'picker';
		decorative?: boolean;
	} = $props();
	let failedUrl = $state<string | null>(null);
	let showImage = $derived(Boolean(imageUrl && failedUrl !== imageUrl));
</script>

<span class={`playlist-artwork playlist-artwork--${variant}`}>
	{#if showImage}
		<img src={imageUrl!} alt={decorative ? '' : `Artwork for ${name}`} loading={variant === 'detail' ? 'eager' : 'lazy'} decoding="async" onerror={() => (failedUrl = imageUrl)} />
	{:else}
		<span class="playlist-artwork__fallback" aria-hidden="true">
			<svg viewBox="0 0 100 100" role="presentation" focusable="false">
				<circle cx="50" cy="50" r="32"></circle>
				<circle cx="50" cy="50" r="9"></circle>
				<path d="M50 18v23M50 59v23M18 50h23M59 50h23"></path>
			</svg>
		</span>
	{/if}
</span>

<style>
	.playlist-artwork { display: block; flex: 0 0 auto; overflow: hidden; aspect-ratio: 1; border: 1px solid var(--accent-border); border-radius: 0.8rem; background: var(--artwork-bg); box-shadow: var(--shadow-card); }
	.playlist-artwork--card { width: 3.25rem; }
	.playlist-artwork--picker { width: 2.5rem; border-radius: 0.55rem; }
	.playlist-artwork--detail { width: min(100%, 11rem); border-radius: 1rem; }
	img, .playlist-artwork__fallback, svg { display: block; width: 100%; height: 100%; }
	img { object-fit: cover; }
	.playlist-artwork__fallback { background: var(--artwork-fallback); }
	svg { fill: none; stroke: var(--artwork-stroke); stroke-width: 3; opacity: 0.88; filter: drop-shadow(0 0 0.45rem var(--waveform-shadow)); }
</style>

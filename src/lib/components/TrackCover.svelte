<script lang="ts">
	let {
		coverImageUrl,
		title,
		variant = 'row',
		decorative = true,
		loading = 'lazy'
	}: {
		coverImageUrl: string | null;
		title: string;
		variant?: 'row' | 'owner' | 'detail' | 'player';
		decorative?: boolean;
		loading?: 'eager' | 'lazy';
	} = $props();

	let failedUrl = $state<string | null>(null);
	let showImage = $derived(
		Boolean(coverImageUrl && failedUrl !== coverImageUrl)
	);
</script>

<div class={`track-cover track-cover--${variant}`}>
	{#if showImage}
		<img
			src={coverImageUrl!}
			alt={decorative ? '' : `Cover art for ${title}`}
			{loading}
			decoding="async"
			onerror={() => (failedUrl = coverImageUrl)}
		/>
	{:else}
		<div class="track-cover__fallback" aria-hidden="true">
			<svg viewBox="0 0 100 100" role="presentation" focusable="false">
				<path class="track-cover__glow" d="M-8 63C8 63 13 34 29 34s19 39 35 39 18-49 34-49 18 34 34 34"></path>
				<path d="M-8 57C8 57 13 30 29 30s19 37 35 37 18-45 34-45 18 32 34 32"></path>
				<path d="M-8 68C8 68 13 43 29 43s19 35 35 35 18-42 34-42 18 29 34 29"></path>
			</svg>
		</div>
	{/if}
</div>

<style>
	.track-cover {
		position: relative;
		flex: 0 0 auto;
		overflow: hidden;
		border: 1px solid var(--accent-border);
		border-radius: 0.7rem;
		background: var(--artwork-bg);
		box-shadow: var(--shadow-artwork);
	}

	.track-cover--row {
		width: 3.5rem;
		height: 3.5rem;
	}

	.track-cover--owner {
		width: 4.5rem;
		height: 4.5rem;
	}

	.track-cover--player {
		width: 3.75rem;
		height: 3.75rem;
		border-radius: 0.6rem;
	}

	.track-cover--detail {
		width: min(100%, 18rem);
		aspect-ratio: 1;
		border-radius: 1rem;
	}

	img,
	.track-cover__fallback,
	svg {
		display: block;
		width: 100%;
		height: 100%;
	}

	img {
		object-fit: cover;
	}

	.track-cover__fallback {
		background: var(--artwork-fallback);
	}

	svg {
		fill: none;
		stroke: var(--artwork-stroke);
		stroke-width: 1.3;
		filter: var(--shadow-artwork-icon);
		transform: scale(1.12);
	}

	.track-cover__glow {
		stroke: var(--waveform-highlight);
		stroke-width: 2.2;
		opacity: 0.9;
	}

	@media (max-width: 30rem) {
		.track-cover--owner {
			width: 3.75rem;
			height: 3.75rem;
		}

		.track-cover--player {
			width: 3.25rem;
			height: 3.25rem;
		}
	}
</style>

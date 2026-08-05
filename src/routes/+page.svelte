<script lang="ts">
	import { AudioWaveform } from '$lib';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Audio Library · Discover, play, and manage audio</title>
</svelte:head>

<section class="hero">
	<div class="page-container hero__inner">
		<div class="hero__copy">
			<p class="eyebrow">Your audio, ready to share</p>
			<h1>Discover community audio<span class="hero__punctuation">.</span></h1>
			<p class="lead">
				Upload and organize your audio, browse public tracks, search titles, artists, and
				descriptions, then play, seek, and download. Your own tracks stay easy to manage
				from one secure library.
			</p>
			<div class="hero__actions">
				<a class="hero__link hero__link--primary" href="/tracks">
					<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
						<path d="m10.7 4.2 1.1 2.1 2.2 1.1-2.2 1.1-1.1 2.2-1.1-2.2-2.2-1.1 2.2-1.1zM5.5 12l.8 1.6 1.7.9-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.9zm10.2-1.7.9 1.8 1.9.9-1.9.9-.9 1.9-.9-1.9-1.8-.9 1.8-.9z"></path>
						<path d="M14.5 15.2a5.25 5.25 0 1 0-1.3 1.3l3.9 3.9 1.3-1.3zM6.8 12.3a3.45 3.45 0 1 1 6.9 0 3.45 3.45 0 0 1-6.9 0"></path>
					</svg>
					Browse Tracks
				</a>
				{#if data.user}
					<a class="hero__link" href="/upload">Upload a Track</a>
				{:else}
					<a class="hero__link" href="/login">Login</a>
					<a class="hero__link" href="/register">Register</a>
				{/if}
			</div>
		</div>

		<AudioWaveform class="hero__waveform" />
	</div>
</section>

<section class="features" id="features" aria-labelledby="features-title">
	<div class="page-container features__inner">
	<div class="section-heading">
		<p class="eyebrow">A complete audio workflow</p>
		<h2 id="features-title">From private storage to public listening</h2>
		<p>
			Audio Library keeps upload, discovery, playback, download, and owner controls
			straightforward on desktop and mobile.
		</p>
	</div>

	<div class="card-grid">
		<article class="feature-card feature-card--pink">
			<span class="feature-icon" aria-hidden="true">
				<svg viewBox="0 0 24 24"><path d="M12 16V5m0 0L8 9m4-4 4 4M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15"></path></svg>
			</span>
			<h3>Upload and organize</h3>
			<p>
				Add MP3, WAV, or OGG audio with a title, BPM, musical key, genre, and description.
				Your signed-in username supplies the artist attribution automatically.
			</p>
		</article>
		<article class="feature-card feature-card--lavender">
			<span class="feature-icon" aria-hidden="true">
				<svg viewBox="0 0 24 24"><path d="M4 6.5h7V13H4zm9 0h7V13h-7zM4 15h7v3H4zm9 0h7v3h-7z"></path></svg>
			</span>
			<h3>Browse public tracks</h3>
			<p>
				Open a clear public catalog and detailed track pages with useful, safe metadata.
			</p>
		</article>
		<article class="feature-card feature-card--raspberry">
			<span class="feature-icon" aria-hidden="true">
				<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="5.5"></circle><path d="m15 15 4.5 4.5"></path></svg>
			</span>
			<h3>Search and filter</h3>
			<p>
				Search titles, artists, and descriptions, then refine results by BPM, key, genre,
				and sort order.
			</p>
		</article>
		<article class="feature-card feature-card--plum">
			<span class="feature-icon" aria-hidden="true">
				<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"></circle><path d="m10 8 6 4-6 4z"></path></svg>
			</span>
			<h3>Play and download</h3>
			<p>
				Listen with the persistent player, seek with byte-range streaming, or download a
				safely named copy.
			</p>
		</article>
		<article class="feature-card feature-card--burgundy">
			<span class="feature-icon" aria-hidden="true">
				<svg viewBox="0 0 24 24"><path d="M12 3.5 19 6v5.2c0 4.4-2.8 7.5-7 9.3-4.2-1.8-7-4.9-7-9.3V6z"></path><path d="m9 12 2 2 4-4"></path></svg>
			</span>
			<h3>Manage your tracks</h3>
			<p>
				Review public and private uploads, edit their metadata, and confirm owner-only
				deletion.
			</p>
		</article>
	</div>

	<aside class="library-note">
		<span aria-hidden="true">
			<svg viewBox="0 0 24 24"><path d="M12 3.5 19 6v5.2c0 4.4-2.8 7.5-7 9.3-4.2-1.8-7-4.9-7-9.3V6z"></path><path d="m9 12 2 2 4-4"></path></svg>
		</span>
		<p>
			<strong>Private by design.</strong> Stored filenames, internal identifiers, ownership
			keys, and filesystem paths stay on the server.
		</p>
	</aside>
	</div>
</section>

<style>
	.hero {
		position: relative;
		display: grid;
		align-items: center;
		min-height: clamp(36rem, 72vh, 44rem);
		padding-block: clamp(4.75rem, 8vw, 7rem);
		overflow: hidden;
		color: var(--hero-text);
		background: var(--hero-background);
	}

	.hero::before,
	.hero::after {
		position: absolute;
		width: 0.38rem;
		height: 0.38rem;
		content: '';
		border-radius: 999px;
		background: var(--hero-dot);
		box-shadow: 2.2rem 1.4rem 0 color-mix(in srgb, var(--accent-plum) 32%, transparent);
	}

	.hero::before {
		top: 18%;
		right: 9%;
	}

	.hero::after {
		right: 43%;
		bottom: 18%;
	}

	.hero__inner {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 0.95fr) minmax(28rem, 1.05fr);
		align-items: center;
		gap: clamp(1rem, 3vw, 3rem);
	}

	.hero__copy {
		position: relative;
		z-index: 1;
		min-width: 0;
	}

	.eyebrow {
		margin: 0 0 1rem;
		color: var(--accent-strong);
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h1 {
		max-width: 11ch;
		margin: 0;
		font-size: clamp(3.2rem, 6vw, 5.75rem);
		line-height: 0.99;
		letter-spacing: -0.055em;
		overflow-wrap: anywhere;
		text-wrap: balance;
		text-shadow: var(--shadow-hero-text);
	}

	.hero__punctuation {
		color: var(--accent-strong);
	}

	.lead {
		max-width: 39rem;
		margin: clamp(1.5rem, 3vw, 2rem) 0;
		color: var(--hero-muted);
		font-size: clamp(1rem, 1.55vw, 1.18rem);
		line-height: 1.72;
	}

	.hero__link {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		min-height: 3.4rem;
		padding: 0.8rem 1.15rem;
		color: var(--hero-text);
		border: 1px solid var(--hero-control-border);
		border-radius: 999px;
		background: var(--hero-control-bg);
		font-size: 0.9rem;
		font-weight: 700;
		text-decoration: none;
		transition: background-color 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
	}

	.hero__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 0.85rem;
	}

	.hero__link--primary {
		border-color: transparent;
		color: var(--on-accent);
		background: linear-gradient(135deg, var(--accent), var(--accent-burgundy));
		box-shadow: var(--shadow-accent);
	}

	.hero__link svg {
		width: 1.15rem;
		height: 1.15rem;
		fill: currentColor;
	}

	.hero__link:hover {
		border-color: var(--accent-border);
		background: var(--hero-control-hover);
	}

	.hero__link--primary:hover {
		background: linear-gradient(135deg, var(--accent-hover), var(--accent-burgundy));
		box-shadow: var(--shadow-accent-soft);
	}

	:global(.hero__waveform) {
		width: min(48rem, 53vw);
		margin-right: -8rem;
	}

	.features {
		background: var(--workflow-bg);
		scroll-margin-top: 5rem;
	}

	.features__inner {
		padding-block: clamp(4rem, 8vw, 6.5rem);
	}

	.section-heading {
		max-width: 42rem;
	}

	.section-heading h2 {
		margin: 0;
		color: var(--text);
		font-size: clamp(2rem, 5vw, 3.25rem);
		line-height: 1.08;
		letter-spacing: -0.045em;
	}

	.section-heading > p:last-child {
		margin: 1.25rem 0 0;
		color: var(--text-muted);
		line-height: 1.7;
	}

	.card-grid {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 1rem;
		margin-top: 3rem;
	}

	.feature-card {
		min-height: 16rem;
		padding: 1.5rem;
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: var(--surface);
		box-shadow: var(--shadow-card);
		transition: border-color 150ms ease, box-shadow 150ms ease;
	}

	.feature-card:hover {
		border-color: var(--accent-border);
		box-shadow: var(--shadow-card-hover);
	}

	.feature-icon {
		display: inline-grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		color: var(--accent);
		border-radius: 0.8rem;
		background: var(--badge-pink-bg);
	}

	.feature-icon svg,
	.library-note svg {
		width: 1.3rem;
		height: 1.3rem;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.8;
	}

	.feature-card--lavender .feature-icon {
		color: var(--badge-lavender-text);
		background: var(--badge-lavender-bg);
	}

	.feature-card--plum .feature-icon {
		color: var(--badge-plum-text);
		background: var(--badge-plum-bg);
	}

	.feature-card--burgundy .feature-icon {
		color: var(--badge-burgundy-text);
		background: var(--badge-burgundy-bg);
	}

	h3 {
		margin: 2.25rem 0 0.65rem;
		font-size: 1.15rem;
		letter-spacing: -0.02em;
	}

	.feature-card p {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.95rem;
		line-height: 1.65;
	}

	.library-note {
		display: flex;
		align-items: flex-start;
		gap: 0.85rem;
		margin-top: 1rem;
		padding: 1rem 1.25rem;
		color: var(--text-muted);
		border: 1px solid var(--border);
		border-radius: 0.85rem;
		background: var(--surface-muted);
	}

	.library-note span {
		display: grid;
		flex: 0 0 auto;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		color: var(--on-accent);
		border-radius: 999px;
		background: var(--accent);
	}

	.library-note p {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.5;
	}

	.library-note strong {
		color: var(--text);
	}

	@media (max-width: 75rem) {
		.card-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	@media (max-width: 48rem) {
		.hero {
			min-height: auto;
			padding-block: clamp(4.5rem, 14vw, 6.5rem);
		}

		.feature-card {
			min-height: auto;
		}
	}

	@media (max-width: 50rem) and (min-width: 32.01rem) {
		.card-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 64rem) {
		.hero__inner {
			grid-template-columns: minmax(0, 1fr);
		}

		.hero__copy {
			max-width: 44rem;
		}

		:global(.hero__waveform) {
			position: absolute;
			z-index: 0;
			right: -15rem;
			bottom: -8rem;
			width: 48rem;
			margin: 0;
			opacity: 0.32;
		}
	}

	@media (max-width: 32rem) {
		h1 {
			font-size: clamp(2.75rem, 14vw, 4rem);
		}

		.hero__actions,
		.hero__link {
			width: 100%;
		}

		.card-grid {
			grid-template-columns: 1fr;
		}

		:global(.hero__waveform) {
			right: -23rem;
			opacity: 0.24;
		}
	}
</style>

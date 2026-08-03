<script lang="ts">
	import { AudioWaveform } from '$lib';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let heroHeading = $derived(
		data.user ? `Welcome back, ${data.user.username}` : 'Discover community audio'
	);
</script>

<svelte:head>
	<title>Audio Library · Discover, play, and manage audio</title>
</svelte:head>

<section class="hero">
	<div class="page-container hero__inner">
		<div class="hero__copy">
			<p class="eyebrow">Your audio, ready to share</p>
			<h1>{heroHeading}<span class="hero__punctuation">.</span></h1>
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

<section class="features page-container" id="features" aria-labelledby="features-title">
	<div class="section-heading">
		<p class="eyebrow">A complete audio workflow</p>
		<h2 id="features-title">From private storage to public listening</h2>
		<p>
			Audio Library keeps upload, discovery, playback, download, and owner controls
			straightforward on desktop and mobile.
		</p>
	</div>

	<div class="card-grid">
		<article>
			<span class="card-number" aria-hidden="true">01</span>
			<h3>Upload and organize</h3>
			<p>
				Add MP3, WAV, or OGG audio with a title, BPM, musical key, genre, and description.
				Your signed-in username supplies the artist attribution automatically.
			</p>
		</article>
		<article>
			<span class="card-number" aria-hidden="true">02</span>
			<h3>Browse public tracks</h3>
			<p>
				Open a clear public catalog and detailed track pages with useful, safe metadata.
			</p>
		</article>
		<article>
			<span class="card-number" aria-hidden="true">03</span>
			<h3>Search and filter</h3>
			<p>
				Search titles, artists, and descriptions, then refine results by BPM, key, genre,
				and sort order.
			</p>
		</article>
		<article>
			<span class="card-number" aria-hidden="true">04</span>
			<h3>Play and download</h3>
			<p>
				Listen with the persistent player, seek with byte-range streaming, or download a
				safely named copy.
			</p>
		</article>
		<article>
			<span class="card-number" aria-hidden="true">05</span>
			<h3>Manage your tracks</h3>
			<p>
				Review public and private uploads, edit their metadata, and confirm owner-only
				deletion.
			</p>
		</article>
	</div>

	<aside class="library-note">
		<span aria-hidden="true">i</span>
		<p>
			<strong>Private by design.</strong> Stored filenames, internal identifiers, ownership
			keys, and filesystem paths stay on the server.
		</p>
	</aside>
</section>

<style>
	.hero {
		position: relative;
		display: grid;
		align-items: center;
		min-height: clamp(38rem, 76vh, 46rem);
		padding-block: clamp(5rem, 9vw, 8rem);
		overflow: hidden;
		color: white;
		background:
			radial-gradient(circle at 77% 45%, rgb(98 37 207 / 19%), transparent 28rem),
			radial-gradient(circle at 18% 28%, rgb(36 60 139 / 19%), transparent 28rem),
			linear-gradient(115deg, #080d1f 0%, #0b1026 52%, #100824 100%);
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
		color: #8f86ff;
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
		text-shadow: 0 0.8rem 2.5rem rgb(0 0 0 / 22%);
	}

	.hero__punctuation {
		color: #795cff;
	}

	.lead {
		max-width: 39rem;
		margin: clamp(1.5rem, 3vw, 2rem) 0;
		color: #b7bfd2;
		font-size: clamp(1rem, 1.55vw, 1.18rem);
		line-height: 1.72;
	}

	.hero__link {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		min-height: 3.4rem;
		padding: 0.8rem 1.15rem;
		color: white;
		border: 1px solid rgb(155 166 203 / 29%);
		border-radius: 0.7rem;
		background: rgb(12 18 42 / 64%);
		font-size: 0.9rem;
		font-weight: 700;
		text-decoration: none;
		transition:
			transform 150ms ease,
			background-color 150ms ease;
	}

	.hero__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 0.85rem;
	}

	.hero__link--primary {
		border-color: transparent;
		background: linear-gradient(135deg, #6040ed, #7547f5);
		box-shadow: 0 0.8rem 2rem rgb(79 44 218 / 30%);
	}

	.hero__link svg {
		width: 1.15rem;
		height: 1.15rem;
		fill: currentColor;
	}

	.hero__link:hover {
		transform: translateY(-2px);
		background: rgb(255 255 255 / 12%);
	}

	.hero__link--primary:hover {
		background: linear-gradient(135deg, #7352f7, #875cff);
	}

	:global(.hero__waveform) {
		width: min(48rem, 53vw);
		margin-right: -8rem;
	}

	.features {
		padding-block: clamp(4rem, 8vw, 6.5rem);
		scroll-margin-top: 5rem;
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
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr));
		gap: 1rem;
		margin-top: 3rem;
	}

	article {
		min-height: 15rem;
		padding: 1.5rem;
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: var(--surface);
		box-shadow: 0 1rem 3rem rgb(0 2 12 / 25%);
	}

	.card-number {
		display: inline-grid;
		place-items: center;
		width: 2.2rem;
		height: 2.2rem;
		color: var(--accent);
		border-radius: 0.6rem;
		background: rgb(91 78 232 / 10%);
		font-size: 0.75rem;
		font-weight: 800;
	}

	h3 {
		margin: 2.25rem 0 0.65rem;
		font-size: 1.15rem;
		letter-spacing: -0.02em;
	}

	article p {
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
		color: white;
		border-radius: 999px;
		background: var(--accent);
		font-family: Georgia, serif;
		font-size: 0.9rem;
		font-weight: 700;
	}

	.library-note p {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.5;
	}

	.library-note strong {
		color: var(--text);
	}

	@media (max-width: 48rem) {
		.hero {
			min-height: auto;
			padding-block: clamp(4.5rem, 14vw, 6.5rem);
		}

		.card-grid {
			grid-template-columns: 1fr;
		}

		article {
			min-height: auto;
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

		:global(.hero__waveform) {
			right: -23rem;
			opacity: 0.24;
		}
	}
</style>

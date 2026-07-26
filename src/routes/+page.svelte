<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Audio Library · Discover, play, and manage audio</title>
</svelte:head>

<section class="hero">
	<div class="page-container hero__inner">
		<p class="eyebrow">Your audio, ready to share</p>
		<h1>
			{data.user
				? `Welcome back, ${data.user.username}.`
				: 'Discover community audio.'}
		</h1>
		<p class="lead">
			Upload and organize your audio, browse public tracks, search titles, artists, and
			descriptions, then play, seek, and download. Your own tracks stay easy to manage from
			one secure library.
		</p>
		<div class="hero__actions">
			<a class="hero__link hero__link--primary" href="/tracks">Browse Tracks</a>
			{#if data.user}
				<a class="hero__link" href="/upload">Upload a Track</a>
				<a class="hero__link" href="/my-tracks">Manage My Tracks</a>
			{:else}
				<a class="hero__link" href="/register">Register</a>
				<a class="hero__link" href="/login">Login</a>
			{/if}
			<a class="hero__link" href="#features"
				>Explore features <span aria-hidden="true">↓</span></a
			>
		</div>
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
				Add MP3, WAV, or OGG audio with a title, artist, BPM, musical key, genre, and
				description.
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
				Listen with native audio controls, seek with byte-range streaming, or download a
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
		display: grid;
		align-items: center;
		min-height: min(39rem, calc(100vh - 4.25rem));
		padding-block: clamp(5rem, 11vw, 8.5rem);
		color: white;
		background:
			linear-gradient(120deg, rgb(17 24 39 / 98%), rgb(32 38 75 / 94%)),
			#111827;
	}

	.hero__inner {
		max-width: 64rem;
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
		max-width: 15ch;
		margin: 0;
		font-size: clamp(2.65rem, 8vw, 5.75rem);
		line-height: 0.98;
		letter-spacing: -0.055em;
		overflow-wrap: anywhere;
	}

	.lead {
		max-width: 42rem;
		margin: 2rem 0;
		color: #cbd5e1;
		font-size: clamp(1rem, 2vw, 1.25rem);
		line-height: 1.75;
	}

	.hero__link {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.8rem 1rem;
		color: white;
		border: 1px solid rgb(255 255 255 / 18%);
		border-radius: 0.65rem;
		background: rgb(255 255 255 / 7%);
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
		gap: 0.75rem;
	}

	.hero__link--primary {
		border-color: transparent;
		background: var(--accent);
	}

	.hero__link:hover {
		transform: translateY(-2px);
		background: rgb(255 255 255 / 12%);
	}

	.hero__link--primary:hover {
		background: var(--accent-strong);
	}

	.features {
		padding-block: clamp(4.5rem, 9vw, 7rem);
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
		box-shadow: 0 1rem 3rem rgb(24 32 51 / 5%);
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
		.card-grid {
			grid-template-columns: 1fr;
		}

		article {
			min-height: auto;
		}
	}
</style>

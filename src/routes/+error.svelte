<script lang="ts">
	import { page } from '$app/state';

	const isNotFound = $derived(page.status === 404);
</script>

<svelte:head>
	<title>{isNotFound ? 'Page not found' : 'Something went wrong'} · Audio Library</title>
	<meta
		name="description"
		content={isNotFound
			? 'The requested Audio Library page could not be found.'
			: 'Audio Library could not complete the request.'}
	/>
</svelte:head>

<section class="error-page">
	<div class="page-container error-page__inner">
		<div class="error-card">
			<p class="auth-eyebrow">Error {page.status}</p>
			<h1>{isNotFound ? 'We could not find that page.' : 'Something went wrong.'}</h1>
			<p>
				{isNotFound
					? 'The page or track may have moved, may be unavailable, or may not exist.'
					: 'The request could not be completed right now. Please try again shortly.'}
			</p>
			<div class="error-card__actions">
				<a class="primary-button" href="/tracks">Browse Tracks</a>
				<a class="secondary-button" href="/">Go to Home</a>
			</div>
		</div>
	</div>
</section>

<style>
	.error-page {
		display: grid;
		align-items: center;
		min-height: min(38rem, calc(100vh - 9rem));
		padding-block: clamp(3rem, 9vw, 6rem);
	}

	.error-page__inner {
		display: grid;
		place-items: center;
	}

	.error-card {
		width: min(100%, 42rem);
		padding: clamp(1.5rem, 6vw, 3rem);
		border: 1px solid var(--border);
		border-radius: 1.25rem;
		background: var(--surface);
		box-shadow: 0 1.5rem 4rem rgb(24 32 51 / 9%);
	}

	h1 {
		margin: 0;
		font-size: clamp(2rem, 7vw, 3.5rem);
		line-height: 1.05;
		letter-spacing: -0.045em;
		overflow-wrap: anywhere;
	}

	.error-card > p:not(.auth-eyebrow) {
		max-width: 34rem;
		margin: 1rem 0 0;
		color: var(--text-muted);
		line-height: 1.7;
	}

	.error-card__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 1.75rem;
	}

	@media (max-width: 30rem) {
		.error-card__actions {
			align-items: stretch;
			flex-direction: column;
		}
	}
</style>

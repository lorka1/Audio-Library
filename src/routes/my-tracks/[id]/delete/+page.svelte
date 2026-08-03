<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Delete {data.track.title} · Audio Library</title>
	<meta name="description" content="Confirm permanent deletion of an audio track you own." />
</svelte:head>

<section class="management-page">
	<div class="page-container delete-confirmation-container">
		<a class="back-link" href="/my-tracks">← Back to My Tracks</a>

		<div class="delete-confirmation">
			<p class="auth-eyebrow">Owner-only deletion</p>
			<h1>Delete this track permanently?</h1>
			<p class="delete-confirmation__track">
				<strong>{data.track.title}</strong> by {data.track.artist}
			</p>

			<div class="delete-warning" id="delete-warning">
				<p>The track metadata will be deleted from the database.</p>
				<p>The stored audio file will also be deleted.</p>
				<p>This operation cannot be undone.</p>
			</div>

			{#if form?.message}
				<div class="form-message form-message--error" role="alert">
					{form.message}
				</div>
			{/if}

			<form method="POST" aria-describedby="delete-warning">
				<button class="danger-button" type="submit">Delete permanently</button>
				<a class="secondary-button" href="/my-tracks">Cancel</a>
			</form>
		</div>
	</div>
</section>

<style>
	.delete-confirmation-container {
		max-width: 44rem;
	}

	.delete-confirmation {
		padding: clamp(1.5rem, 5vw, 2.75rem);
		border: 1px solid var(--error-border);
		border-radius: 1.25rem;
		background: var(--surface);
		box-shadow: var(--shadow-card);
	}

	h1 {
		margin: 0;
		font-size: clamp(2rem, 6vw, 3rem);
		line-height: 1.05;
		letter-spacing: -0.045em;
	}

	.delete-confirmation__track {
		margin: 1rem 0 0;
		color: var(--text-muted);
		font-size: 1.05rem;
		overflow-wrap: anywhere;
	}

	.delete-warning {
		display: grid;
		gap: 0.5rem;
		margin: 1.5rem 0;
		padding: 1rem;
		color: var(--error-strong);
		border: 1px solid var(--error-border);
		border-radius: 0.75rem;
		background: var(--error-bg);
	}

	.delete-warning p {
		margin: 0;
	}

	form {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.danger-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 3rem;
		padding: 0.75rem 1rem;
		color: var(--on-accent);
		border: 0;
		border-radius: 0.65rem;
		background: var(--danger-button);
		font-weight: 800;
		cursor: pointer;
	}

	.danger-button:hover {
		background: var(--danger-button-hover);
	}

	form a {
		color: var(--accent-strong);
		font-weight: 750;
	}

	@media (max-width: 30rem) {
		form {
			align-items: stretch;
			flex-direction: column;
		}

		form a {
			padding: 0.5rem;
			text-align: center;
		}
	}
</style>

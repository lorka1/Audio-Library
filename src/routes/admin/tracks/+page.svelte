<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatDate } from '$lib/formatting';
	import { useAudioPlayer } from '$lib/player/context';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const player = useAudioPlayer();
	let deletingTrackId = $state<number | null>(null);

	const enhanceDeletion: SubmitFunction = ({ formData, submitter, cancel }) => {
		const submittedTrackId = formData.get('trackId');
		const publicId =
			typeof submittedTrackId === 'string' ? Number(submittedTrackId) : Number.NaN;
		const title = submitter?.dataset.trackTitle ?? 'this track';

		if (!Number.isSafeInteger(publicId) || !window.confirm(`Delete “${title}” permanently?`)) {
			cancel();
			return;
		}

		deletingTrackId = publicId;
		return async ({ result, update }) => {
			try {
				if (result.type === 'success') player.clearIfTrackId(publicId);
				await update();
			} finally {
				deletingTrackId = null;
			}
		};
	};
</script>

<svelte:head>
	<title>Manage Tracks · Admin · Audio Library</title>
	<meta name="description" content="Administrator moderation list for all audio tracks." />
</svelte:head>

<section class="admin-page">
	<div class="page-container admin-page__inner">
		<a class="back-link" href="/admin">← Back to Admin Dashboard</a>
		<header class="admin-heading">
			<p class="auth-eyebrow">Administrator area</p>
			<h1>Manage tracks</h1>
			<p>All uploads are shown here for administrator moderation.</p>
		</header>

		{#if form?.message}
			<div
				class="form-message"
				class:form-message--success={form.success}
				class:form-message--error={!form.success}
				role={form.success ? 'status' : 'alert'}
			>
				{form.message}
			</div>
		{/if}

		<p class="result-count">
			{data.tracks.length} {data.tracks.length === 1 ? 'audio track' : 'audio tracks'}
		</p>

		{#if data.tracks.length > 0}
			<div class="admin-table-wrap">
				<table>
					<thead>
						<tr>
							<th scope="col">Title</th>
							<th scope="col">Artist</th>
							<th scope="col">Owner</th>
							<th scope="col">Created</th>
							<th scope="col">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each data.tracks as track (track.publicId)}
							<tr>
								<td data-label="Title"><strong>{track.title}</strong></td>
								<td data-label="Artist">{track.artist}</td>
								<td data-label="Owner">{track.ownerUsername}</td>
								<td data-label="Created">
									<time datetime={track.createdAt}>{formatDate(track.createdAt)}</time>
								</td>
								<td data-label="Actions" class="track-actions">
									<a href={`/tracks/${track.publicId}`}>View</a>
									<form method="POST" action="?/delete" use:enhance={enhanceDeletion}>
										<input type="hidden" name="trackId" value={track.publicId} />
										<button
											type="submit"
											data-track-title={track.title}
											disabled={deletingTrackId !== null}
										>
											{deletingTrackId === track.publicId ? 'Deleting…' : 'Delete'}
										</button>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<div class="tracks-empty"><p>No audio tracks were found.</p></div>
		{/if}
	</div>
</section>

<style>
	.admin-page {
		padding-block: clamp(3rem, 8vw, 6rem);
	}

	.admin-page__inner {
		max-width: 86rem;
	}

	.admin-heading {
		max-width: 48rem;
		margin-bottom: 1.5rem;
	}

	.admin-heading h1 {
		margin: 0;
		font-size: clamp(2.25rem, 7vw, 4rem);
		line-height: 1;
		letter-spacing: -0.05em;
	}

	.admin-heading p:last-child {
		margin: 1rem 0 0;
		color: var(--text-muted);
		line-height: 1.65;
	}

	.result-count {
		margin: 1rem 0;
		font-weight: 800;
	}

	.admin-table-wrap {
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: var(--surface);
		box-shadow: var(--shadow-card);
	}

	table {
		width: 100%;
		border-collapse: collapse;
	}

	th,
	td {
		padding: 1rem;
		border-bottom: 1px solid var(--border);
		text-align: left;
		vertical-align: middle;
	}

	th {
		color: var(--text-muted);
		background: var(--surface-muted);
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	tbody tr:last-child td {
		border-bottom: 0;
	}

	td {
		overflow-wrap: anywhere;
	}

	.track-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.track-actions a,
	.track-actions button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.4rem;
		padding: 0.5rem 0.7rem;
		border-radius: 0.5rem;
		font-size: 0.8rem;
		font-weight: 750;
		text-decoration: none;
	}

	.track-actions a {
		color: var(--link);
		border: 1px solid var(--accent-border);
	}

	.track-actions button {
		color: var(--error);
		border: 1px solid var(--error-border);
		background: transparent;
		cursor: pointer;
	}

	.track-actions button:hover:not(:disabled) {
		background: var(--error-bg);
	}

	.track-actions button:disabled {
		color: var(--disabled-text);
		border-color: var(--border);
		cursor: wait;
	}

	@media (max-width: 48rem) {
		.admin-table-wrap {
			overflow: visible;
			border: 0;
			background: transparent;
			box-shadow: none;
		}

		table,
		tbody,
		tr,
		td {
			display: block;
		}

		thead {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0 0 0 0);
			white-space: nowrap;
		}

		tbody {
			display: grid;
			gap: 0.75rem;
		}

		tr {
			padding: 0.65rem 1rem;
			border: 1px solid var(--border);
			border-radius: 0.85rem;
			background: var(--surface);
		}

		td,
		tbody tr:last-child td {
			display: grid;
			grid-template-columns: minmax(6.5rem, 0.7fr) minmax(0, 1.3fr);
			gap: 0.75rem;
			padding: 0.7rem 0;
			border-bottom: 1px solid var(--border);
		}

		td:last-child {
			border-bottom: 0;
		}

		td::before {
			content: attr(data-label);
			color: var(--text-muted);
			font-size: 0.72rem;
			font-weight: 800;
			letter-spacing: 0.05em;
			text-transform: uppercase;
		}

		.track-actions {
			display: flex;
			flex-wrap: wrap;
		}

		.track-actions::before {
			width: 100%;
		}
	}
</style>

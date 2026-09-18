<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatDate } from '$lib/formatting';
	import { useAudioPlayer } from '$lib/player/context';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const player = useAudioPlayer();
	let deletingUserId = $state<string | null>(null);

	const enhanceDeletion: SubmitFunction = ({ formData, cancel }) => {
		const userId = formData.get('userId');
		if (typeof userId !== 'string') {
			cancel();
			return;
		}
		deletingUserId = userId;
		return async ({ result, update }) => {
			try {
				if (result.type === 'success') {
					const deletedTrackIds = result.data?.deletedTrackIds;
					if (Array.isArray(deletedTrackIds)) {
						player.clearIfTrackIds(
							deletedTrackIds.filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id))
						);
					}
				}
				await update();
			} finally {
				deletingUserId = null;
			}
		};
	};
</script>

<svelte:head>
	<title>Manage Users · Admin · Audio Library</title>
	<meta name="description" content="Administrator account management." />
</svelte:head>

<section class="admin-page">
	<div class="page-container admin-page__inner">
		<a class="back-link" href="/admin">← Back to Admin Dashboard</a>
		<header class="admin-heading">
			<p class="auth-eyebrow">Administrator area</p>
			<h1>Manage users</h1>
			<p>Manage accounts and review their roles and uploads.</p>
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
			{data.users.length} {data.users.length === 1 ? 'registered user' : 'registered users'}
		</p>

		{#if data.users.length > 0}
			<div class="admin-table-wrap">
				<table>
					<thead>
						<tr>
							<th scope="col">Username</th>
							<th scope="col">Email</th>
							<th scope="col">Role</th>
							<th scope="col">Registered</th>
							<th scope="col">Tracks</th>
							<th scope="col">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each data.users as user (user.id)}
							<tr class:administrator={user.role === 'admin'}>
								<td data-label="Username"><strong>{user.username}</strong></td>
								<td data-label="Email">{user.email}</td>
								<td data-label="Role">
									<span class:role-admin={user.role === 'admin'} class="role-badge">
										{user.role === 'admin' ? 'Administrator' : 'User'}
									</span>
								</td>
								<td data-label="Registered">
									<time datetime={user.createdAt}>{formatDate(user.createdAt)}</time>
								</td>
								<td data-label="Tracks">{user.uploadedTrackCount}</td>
								<td data-label="Actions" class="user-actions">
									{#if user.id === data.currentAdminId}
										<span class="self-delete-note">Current account — cannot delete</span>
									{:else}
										<details class="delete-confirmation">
											<summary>Delete</summary>
											<p>Delete {user.username} and all their tracks and playlists?</p>
											<form method="POST" action="?/delete" use:enhance={enhanceDeletion}>
												<input type="hidden" name="userId" value={user.id} />
												<button type="submit" disabled={deletingUserId !== null}>
													{deletingUserId === user.id ? 'Deleting…' : 'Confirm delete'}
												</button>
											</form>
										</details>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<div class="tracks-empty"><p>No registered users were found.</p></div>
		{/if}
	</div>
</section>

<style>
	.admin-page {
		padding-block: clamp(3rem, 8vw, 6rem);
	}

	.admin-page__inner {
		max-width: 78rem;
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
		margin: 0 0 1rem;
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

	tbody tr.administrator {
		background: var(--accent-soft);
	}

	.role-badge {
		display: inline-flex;
		padding: 0.3rem 0.55rem;
		color: var(--text-muted);
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 800;
	}

	.role-badge.role-admin {
		color: var(--accent-strong);
		border-color: var(--accent-border);
		background: var(--accent-soft);
	}

	.delete-confirmation summary,
	.user-actions button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.4rem;
		padding: 0.5rem 0.7rem;
		color: var(--error);
		border: 1px solid var(--error-border);
		border-radius: 0.5rem;
		background: transparent;
		font-size: 0.8rem;
		font-weight: 750;
		cursor: pointer;
	}

	.delete-confirmation summary {
		list-style: none;
	}

	.delete-confirmation summary::-webkit-details-marker {
		display: none;
	}

	.delete-confirmation p {
		max-width: 12rem;
		margin: 0.6rem 0;
		color: var(--text-muted);
		font-size: 0.8rem;
		line-height: 1.4;
	}

	.delete-confirmation summary:hover,
	.user-actions button:hover:not(:disabled) {
		background: var(--error-bg);
	}

	.user-actions button:disabled {
		color: var(--disabled-text);
		border-color: var(--border);
		cursor: wait;
	}

	.self-delete-note {
		color: var(--text-muted);
		font-size: 0.8rem;
	}

	@media (max-width: 44rem) {
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
			overflow-wrap: anywhere;
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
	}
</style>

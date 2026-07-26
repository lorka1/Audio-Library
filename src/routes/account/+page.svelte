<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const joinedDate = $derived(
		new Intl.DateTimeFormat('en', {
			dateStyle: 'long',
			timeZone: 'UTC'
		}).format(data.user.createdAt)
	);
</script>

<svelte:head>
	<title>Account · Audio Library</title>
	<meta name="description" content="View your Audio Library account details." />
</svelte:head>

<section class="account-page">
	<div class="page-container account-page__inner">
		<header class="account-heading">
			<p class="auth-eyebrow">Protected account</p>
			<h1>Your account</h1>
			<p>This page is available only while you have an active session.</p>
		</header>

		<div class="account-card">
			<div class="account-avatar" aria-hidden="true">
				{data.user.username.slice(0, 1).toUpperCase()}
			</div>

			<dl class="account-details">
				<div>
					<dt>Username</dt>
					<dd>{data.user.username}</dd>
				</div>
				<div>
					<dt>Email</dt>
					<dd>{data.user.email}</dd>
				</div>
				<div>
					<dt>Member since</dt>
					<dd>{joinedDate}</dd>
				</div>
			</dl>
		</div>

		<div class="account-note">
			<p>Your account details are available only during your authenticated session.</p>
		</div>
	</div>
</section>

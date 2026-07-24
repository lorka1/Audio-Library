<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Login · Audio Library</title>
	<meta name="description" content="Log in securely to your Audio Library account." />
</svelte:head>

<section class="auth-page">
	<div class="page-container auth-page__inner">
		<div class="auth-card">
			<header class="auth-card__header">
				<p class="auth-eyebrow">Welcome back</p>
				<h1>Log in to your library.</h1>
				<p>Use the email address and password connected to your account.</p>
			</header>

			{#if form?.message}
				<div class="form-message form-message--error" role="alert">{form.message}</div>
			{/if}

			<form method="POST" class="form-stack">
				<input type="hidden" name="redirectTo" value={data.redirectTo} />

				<div class="form-field">
					<label for="email">Email</label>
					<input
						id="email"
						name="email"
						type="email"
						autocomplete="email"
						required
						maxlength="254"
						value={form?.values.email ?? ''}
						aria-invalid={form?.errors.email ? 'true' : undefined}
						aria-describedby={form?.errors.email ? 'email-error' : undefined}
					/>
					{#if form?.errors.email}
						<p class="field-error" id="email-error">{form.errors.email}</p>
					{/if}
				</div>

				<div class="form-field">
					<label for="password">Password</label>
					<input
						id="password"
						name="password"
						type="password"
						autocomplete="current-password"
						required
						aria-invalid={form?.errors.password ? 'true' : undefined}
						aria-describedby={form?.errors.password ? 'password-error' : undefined}
					/>
					{#if form?.errors.password}
						<p class="field-error" id="password-error">{form.errors.password}</p>
					{/if}
				</div>

				<button class="primary-button" type="submit">Login</button>
			</form>

			<p class="auth-switch">
				Need an account? <a href="/register">Register</a>
			</p>
		</div>
	</div>
</section>

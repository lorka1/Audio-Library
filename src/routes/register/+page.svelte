<script lang="ts">
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<svelte:head>
	<title>Create account · Audio Library</title>
	<meta
		name="description"
		content="Create an Audio Library account with a username, email address, and secure password."
	/>
</svelte:head>

<section class="auth-page">
	<div class="page-container auth-page__inner">
		<div class="auth-card">
			<header class="auth-card__header">
				<p class="auth-eyebrow">Create your account</p>
				<h1>Start your audio library.</h1>
				<p>Register securely. You will be signed in as soon as your account is created.</p>
			</header>

			{#if form?.message}
				<div class="form-message form-message--error" role="alert">{form.message}</div>
			{/if}

			<form method="POST" class="form-stack">
				<div class="form-field">
					<label for="username">Username</label>
					<input
						id="username"
						name="username"
						type="text"
						autocomplete="username"
						required
						minlength="3"
						maxlength="30"
						pattern="[A-Za-z0-9_]+"
						value={form?.values.username ?? ''}
						aria-invalid={form?.errors.username ? 'true' : undefined}
						aria-describedby={form?.errors.username ? 'username-error' : 'username-help'}
					/>
					{#if form?.errors.username}
						<p class="field-error" id="username-error">{form.errors.username}</p>
					{:else}
						<p class="field-help" id="username-help">3–30 letters, numbers, or underscores.</p>
					{/if}
				</div>

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
						autocomplete="new-password"
						required
						minlength="8"
						maxlength="128"
						aria-invalid={form?.errors.password ? 'true' : undefined}
						aria-describedby={form?.errors.password ? 'password-error' : 'password-help'}
					/>
					{#if form?.errors.password}
						<p class="field-error" id="password-error">{form.errors.password}</p>
					{:else}
						<p class="field-help" id="password-help">Use at least 8 characters.</p>
					{/if}
				</div>

				<div class="form-field">
					<label for="confirmPassword">Confirm password</label>
					<input
						id="confirmPassword"
						name="confirmPassword"
						type="password"
						autocomplete="new-password"
						required
						minlength="8"
						maxlength="128"
						aria-invalid={form?.errors.confirmPassword ? 'true' : undefined}
						aria-describedby={form?.errors.confirmPassword
							? 'confirm-password-error'
							: undefined}
					/>
					{#if form?.errors.confirmPassword}
						<p class="field-error" id="confirm-password-error">
							{form.errors.confirmPassword}
						</p>
					{/if}
				</div>

				<button class="primary-button" type="submit">Create account</button>
			</form>

			<p class="auth-switch">
				Already have an account? <a href="/login">Log in</a>
			</p>
		</div>
	</div>
</section>

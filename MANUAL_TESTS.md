# Manual authentication tests

Run the application with:

```powershell
npm run db:migrate
npm run dev
```

Use unique synthetic account details that are not used for any real service.

## Registration

- [ ] Open `/register` while signed out. The registration form is displayed.
- [ ] Submit all fields empty. Required-field feedback is shown and no account is created.
- [ ] Submit a username shorter than three characters. A username length error is shown.
- [ ] Submit a username containing a hyphen or space. An allowed-characters error is shown.
- [ ] Submit an invalid email. An email validation error is shown.
- [ ] Submit a password shorter than eight characters. A password length error is shown.
- [ ] Submit different password and confirmation values. A mismatch error is shown.
- [ ] Register with valid unique details. You are redirected home and shown as signed in.
- [ ] Log out, then try registering with the same email. A clear occupied-email error is shown.
- [ ] Try registering with the same username and a different email. A clear occupied-username error is shown.

## Login and session persistence

- [ ] Open `/login` while signed out. The login form is displayed.
- [ ] Submit an unknown email and a password. The message is exactly `Email or password is incorrect.`
- [ ] Submit an existing email with a wrong password. The same generic message is shown.
- [ ] Log in with correct credentials. You are redirected home and your username appears in navigation.
- [ ] Refresh the page. You remain signed in.
- [ ] Close and reopen the browser before the seven-day expiry. The session remains active.
- [ ] Inspect the cookie in browser developer tools. It is HttpOnly, SameSite=Lax, scoped to `/`, and has an expiry.
- [ ] In a production HTTPS deployment, confirm the session cookie also has the Secure flag.
- [ ] Inspect the `sessions` table. It contains a token hash, never the raw cookie token.

## Protected and guest-only routes

- [ ] While signed out, open `/account`. You are redirected to `/login`.
- [ ] Log in after that redirect. You return to `/account`.
- [ ] While signed in, open `/account`. Username and email are displayed; no password hash or session token appears.
- [ ] While signed in, open `/login`. You are redirected home.
- [ ] While signed in, open `/register`. You are redirected home.

## Logout and invalid sessions

- [ ] Use the navigation Logout button. The request uses POST and you are redirected home.
- [ ] Refresh after logout. You remain signed out.
- [ ] After logout, open `/account`. You are redirected to `/login`.
- [ ] Replace the session cookie with a malformed value and refresh. The application remains available and clears the cookie.
- [ ] Remove the current session row from the local database, then refresh. The application signs you out without exposing an internal error.
- [ ] Set a session expiry in the past, then refresh. The session is removed and the browser cookie is cleared.

## Phase boundary

- [ ] Confirm there are no upload, playback, streaming, download, search, editing, or track-deletion controls.

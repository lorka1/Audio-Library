# Audio Library

Audio Library is a SvelteKit application with a local SQLite database and
secure account sessions. **Phase 2** currently provides registration, login,
logout, persistent authentication, and a protected account page. Audio upload
and playback features have not been implemented.

## Prerequisites

- Node.js 22.12.x or 24+ (verified with Node.js 24.7.0)
- npm 10 or newer (verified with npm 11.6.0)

## First-time setup

```powershell
npm install
Copy-Item .env.example .env
npm run db:migrate
npm run dev
```

On macOS or Linux, replace `Copy-Item` with:

```sh
cp .env.example .env
```

The local `.env` file already exists in the current workspace. Because it is
excluded from Git, `.env.example` must be copied in every new clone.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Starts the development server |
| `npm run build` | Creates the production Node build |
| `npm run preview` | Runs the built application locally |
| `npm run check` | Synchronizes SvelteKit and checks Svelte/TypeScript |
| `npm run check:watch` | Runs checks in watch mode |
| `npm run test` | Runs the Vitest test suite once |
| `npm run test:watch` | Runs Vitest in watch mode |
| `npm run db:generate` | Generates a SQL migration after a schema change |
| `npm run db:migrate` | Applies all pending migrations |
| `npm run db:studio` | Opens Drizzle Studio |

The project does not currently define a separate lint command. TypeScript and
Svelte diagnostics are enforced through `npm run check`.

## Configuration

The variables are documented in `.env.example`:

- `DATABASE_URL` — path to the local SQLite file
- `AUDIO_STORAGE_PATH` — reserved path for future audio storage
- `SESSION_COOKIE_NAME` — name of the private authentication cookie
- `SESSION_DURATION_DAYS` — session and cookie lifetime in days

The default session lifetime is seven days. Supported configured values are
whole numbers from 1 through 30.

## Authentication and sessions

Registration is available at `/register` and login at `/login`. Both use
SvelteKit server form actions, so they work without client-side JavaScript.
Validation is always repeated on the server.

Passwords are:

- never returned to a page or written to logs
- validated before hashing
- hashed with salted bcryptjs hashes
- rejected if they exceed bcrypt's safe 72-byte UTF-8 input limit

Sessions use a cryptographically random 32-byte token. The raw token exists
only in an HttpOnly, SameSite=Lax cookie. The database stores only the
token's SHA-256 hash, so the database never contains a usable session token.
Cookies are marked Secure outside development and expire with the database
session.

`src/hooks.server.ts` validates the cookie on every request and populates
`App.Locals` with safe user and session objects. Password hashes and session
token hashes are never included in locals or layout data.

The `/account` page requires authentication. Signed-out visitors are sent to
login and returned to the protected page after successful authentication.
Login and registration pages redirect authenticated users home. Logout is a
POST-only operation that removes the database session and clears the cookie.

## Database and migrations

The project uses Drizzle ORM with a local SQLite-compatible
`@libsql/client` file driver. Apply all committed migrations with:

```powershell
npm run db:migrate
```

When the TypeScript schema changes, generate and inspect a new migration before
applying it:

```powershell
npm run db:generate
npm run db:migrate
```

Phase 2 adds a unique `sessions.token_hash` column. Existing Phase 1
migrations remain unchanged.

## Structure

```text
drizzle/                    versioned SQL migrations
src/
  lib/
    components/             shared UI components
    server/
      auth/                 validation, password, session, repository, and guards
      db/                   SQLite connection, Drizzle schema, and database types
    types/                  shared client-safe TypeScript types
  routes/
    account/                protected account page
    login/                  login form and action
    logout/                 POST-only logout endpoint
    register/               registration form and action
storage/audio/              future audio storage (contents ignored)
```

## Testing

Run the automated unit tests with:

```powershell
npm run test
```

The tests cover input normalization and validation, password hashing and
verification, bcrypt salting, and session token hashing. Browser-level checks
for registration, login, persistence, guards, cookies, and logout are listed
in `MANUAL_TESTS.md`.

## Phase 2 boundary

Phase 2 intentionally does not include audio upload, playback, streaming,
download, search, filtering, editing, deletion, BPM analysis, or key
detection. Those features remain reserved for later phases.

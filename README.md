# Audio Library

The initial foundation for a SvelteKit application that will store and manage
audio tracks. Only **Phase 1** is currently complete: the project scaffold,
global layout, SQLite database, Drizzle ORM, initial schema, and migrations.
Authentication and audio track features have not been implemented yet.

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
correctly excluded from Git, the example must be copied in every new clone.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Starts the development server |
| `npm run build` | Creates the production Node build |
| `npm run preview` | Runs the built application locally |
| `npm run check` | Synchronizes SvelteKit and checks Svelte/TypeScript |
| `npm run check:watch` | Runs checks in watch mode |
| `npm run db:generate` | Generates a new SQL migration after a schema change |
| `npm run db:migrate` | Applies all pending migrations |
| `npm run db:studio` | Opens Drizzle Studio |

Tests have not been introduced in Phase 1, so the project does not currently
have a `test` script.

## Configuration

The variables are documented in `.env.example`:

- `DATABASE_URL` — path to the local SQLite file
- `AUDIO_STORAGE_PATH` — path to the audio file directory

Both default paths are relative to the project root. The database and audio
content are runtime data and are not stored in Git.

The local SQLite file is opened with the stable `@libsql/client` file driver,
without requiring an additional local C++ toolchain. The application targets a
Node runtime with a persistent file system, matching the
`@sveltejs/adapter-node` production build.

## Structure

```text
drizzle/                    versioned SQL migrations
src/
  lib/
    components/             shared UI components
    server/db/              SQLite connection, Drizzle schema, and database types
    types/                  shared TypeScript types
  routes/                   SvelteKit pages and global layout
data/                       local SQLite database (ignored)
storage/audio/              future audio storage (contents ignored)
```

## Phase 1 boundary

The schema prepares the `users`, `sessions`, and `tracks` tables, but the
project does not yet include registration, sign-in, upload, streaming,
download, search, editing, or deletion. Those features are intentionally left
for later phases.

# Audio Library

Audio Library is a SvelteKit application for uploading, browsing, searching,
streaming, downloading, and managing privately stored audio. MongoDB is the
only persistence backend. Audio bytes remain in a private filesystem directory;
MongoDB stores users, hashed sessions, track metadata, ownership, public route
IDs, and private storage references.

## Requirements

- Node.js `^22.12.0` or `>=24`
- npm `>=10`
- MongoDB reachable as a replica set, sharded deployment, or Atlas cluster

Registration creates a user and initial session in one transaction. A
standalone MongoDB server without transaction support is rejected.

## Setup

Install the lockfile dependencies:

```powershell
npm ci
```

Create the local environment file:

```powershell
Copy-Item .env.example .env
```

Configure these values in the untracked `.env`:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | Connection string for the transaction-capable MongoDB deployment. Never commit credentials. |
| `MONGODB_DB_NAME` | Application database name. |
| `MONGODB_TEST_DB_NAME` | Base name for uniquely owned integration databases. It must start with `audio_library_test_` and differ from the application database. |
| `AUDIO_STORAGE_PATH` | Private filesystem directory for audio bytes. |
| `MAX_AUDIO_FILE_SIZE_MB` | Application upload limit. |
| `BODY_SIZE_LIMIT` | Adapter request limit, including multipart overhead. |
| `SESSION_COOKIE_NAME` | HttpOnly session cookie name. |
| `SESSION_DURATION_DAYS` | Session lifetime from 1 through 30 days. |

Start development:

```powershell
npm run dev
```

## MongoDB initialization

Server startup connects through one centralized server-only client and
idempotently ensures required indexes for:

- unique usernames and emails;
- unique session token hashes, session ownership, and expiration;
- unique track public IDs and storage keys;
- owner/public query paths, BPM, musical key, and genre.

Check connectivity, database selection, and indexes without modifying
application documents:

```powershell
npm run db:mongodb:check
```

Run the complete read-only data/audio safety audit:

```powershell
npm run db:mongodb:audit
```

## Features

- registration, login, logout, session validation, and session expiration;
- transactional user/session creation;
- public Browse with literal substring search;
- inclusive BPM bounds, key and genre filters, and combined filters;
- newest, oldest, title ascending/descending, and BPM ascending/descending
  ordering with deterministic tie handling;
- public numeric detail URLs;
- full streaming, byte Range seeking, invalid Range handling, and downloads;
- private owner dashboard, metadata editing, and deletion;
- quarantine-based filesystem deletion with database-failure restoration;
- safe public, owner, account, navigation, and server-only projections.

Route modules do not select or construct persistence implementations. Central
server-only persistence modules provide the MongoDB repositories.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server. |
| `npm run check` | Run Svelte and TypeScript diagnostics. |
| `npm test` | Run all Vitest tests once. |
| `npm run build` | Create the production Node build. |
| `npm run preview` | Preview the production build through Vite. |
| `npm run db:mongodb:check` | Check connectivity, target selection, and indexes read-only. |
| `npm run db:mongodb:audit` | Audit MongoDB and audio using safe aggregates only. |
| `npm run test:mongodb:users` | Verify the user repository contract in a uniquely owned database. |
| `npm run test:mongodb:auth` | Verify transactions, duplicate conflicts, sessions, expiration, logout, and cleanup. |
| `npm run test:mongodb:tracks` | Verify public IDs, projections, owner CRUD, filesystem consistency, failure recovery, and cleanup. |
| `npm run test:mongodb:queries` | Verify search, filters, all six sorts, literal regex handling, projections, and cleanup. |
| `npm run test:mongodb:cutover` | Run the isolated full-application registration, upload, media, owner-management, and cleanup flow. |
| `npm run test:mongodb:regression` | Run the aggregate MongoDB contract, failure-path, privacy, query, and full-application regression. |
| `npm run verify:mongodb:clean-clone` | Install and verify an isolated release-candidate copy with an owned test database and production probe. |

Integration controllers generate one unique safe test database, record its
ownership, drop only that exact database, preserve every pre-existing database,
use temporary audio storage and ports, and close their clients, sessions,
processes, listeners, and timers.

## Production

Build and start the adapter-node output:

```powershell
npm run build
$env:HOST='127.0.0.1'
$env:PORT='3000'
$env:ORIGIN='https://your-host.example'
node build/index.js
```

Provide all environment values through the deployment platform. Keep
`AUDIO_STORAGE_PATH` on persistent private storage, back up MongoDB and audio
independently, and never expose the storage directory through a static file
server.

## Privacy and storage

Browser payloads never receive password hashes, raw or hashed session tokens,
internal user/track identifiers, owner IDs, storage keys, absolute paths,
database names, connection strings, or private audit information.

Audio is not stored in MongoDB or GridFS. Upload metadata and filesystem writes
use compensating cleanup, while deletion uses quarantine/restore semantics to
keep metadata and files consistent across failure paths.

## Historical migration

The project originally used SQLite and Drizzle. Users and track metadata were
migrated transactionally to MongoDB while preserving identifiers, password
hashes, ownership, public IDs, visibility, nullable metadata, timestamps, and
storage references. Sessions were intentionally not migrated, so users had to
sign in again after cutover. Audio bytes were never migrated into MongoDB.

SQLite and Drizzle are no longer application dependencies. A verified
historical SQLite backup and sanitized cutover package remain outside Git; they
are not required by setup, runtime, tests, or production operation. See
[`docs/mongodb-migration.md`](docs/mongodb-migration.md).

The active persistence coverage is documented in
[`docs/persistence-feature-matrix.md`](docs/persistence-feature-matrix.md).

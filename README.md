# Audio Library

Audio Library is a server-rendered SvelteKit application for uploading,
organizing, discovering, and listening to audio tracks. It combines secure
account sessions and private file storage with public search, byte-range
playback, safe downloads, and owner-only track management.

## Features

- Register, log in, log out, and keep a secure cookie-backed session.
- Upload MP3, WAV, and OGG files with validated metadata and size limits.
- Browse public tracks and open detailed listening pages without signing in.
- Search titles, artists, and descriptions; filter by BPM, key, and genre; and
  use deterministic server-side sorting.
- Start, pause, switch, and seek public tracks through one persistent global
  player backed by HTTP byte-range responses.
- Download tracks with sanitized user-facing filenames.
- Review public and private owned tracks in My Tracks.
- Edit owned track metadata without changing identity, ownership, visibility,
  filenames, or audio bytes.
- Confirm owner-only deletion with coordinated database and filesystem cleanup.
- Use browsing, forms, filters, navigation, downloads, and direct media links
  without client-side JavaScript; persistent playback is a focused client-side
  enhancement.

## Tech stack

- Svelte 5 and SvelteKit 2
- TypeScript 6, Vite 8, and the SvelteKit Node adapter
- Drizzle ORM with SQLite through `@libsql/client`
- `bcryptjs` password hashing and SHA-256 session-token hashing
- Vitest, `svelte-check`, and bounded HTTP integration controllers

## Screenshots

Screenshots are intentionally not fabricated or committed yet. The prepared
directory is `docs/screenshots`, with these expected filenames:

- `docs/screenshots/home.png`
- `docs/screenshots/tracks.png`
- `docs/screenshots/track-details.png`
- `docs/screenshots/upload.png`
- `docs/screenshots/my-tracks.png`

After safe captures are added, the corresponding Markdown can be enabled:

```markdown
<!-- ![Audio Library home page](docs/screenshots/home.png) -->
<!-- ![Public track browser](docs/screenshots/tracks.png) -->
<!-- ![Track details and player](docs/screenshots/track-details.png) -->
<!-- ![Audio upload form](docs/screenshots/upload.png) -->
<!-- ![Owner track management](docs/screenshots/my-tracks.png) -->
```

Safe screenshot checklist:

- Use an isolated database and storage directory with synthetic accounts and
  disposable audio.
- Keep real email addresses, metadata, and audio out of every capture.
- Capture the application viewport only; exclude DevTools, cookies, session
  values, local paths, and terminal output.
- Inspect the final pixels and PNG metadata for internal UUIDs, owner IDs,
  emails, stored filenames, and filesystem paths.
- Sign out and remove the disposable runtime data after capturing desktop and
  mobile views.

## Requirements

- Node.js `^22.12.0` or `>=24.0.0`
- npm `>=10.0.0`

## Setup

```powershell
npm ci
Copy-Item .env.example .env
npm run db:migrate
npm run dev
```

On macOS or Linux, copy the environment file with:

```sh
cp .env.example .env
```

The development server prints its local URL. Register a disposable account to
upload a track, or open `/tracks` to browse the public library.

## Configuration

`.env.example` documents every application setting:

```dotenv
DATABASE_URL=./data/app.db
DATABASE_BACKEND=sqlite
AUDIO_STORAGE_PATH=storage/audio
MAX_AUDIO_FILE_SIZE_MB=50
BODY_SIZE_LIMIT=55M
SESSION_COOKIE_NAME=audio_library_session
SESSION_DURATION_DAYS=7
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB_NAME=audio_library_dev
MONGODB_TEST_DB_NAME=audio_library_test_local
```

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Required path to the SQLite database file. |
| `DATABASE_BACKEND` | Server-only auth persistence selector: `sqlite` or `mongodb`. It defaults to `sqlite` and always selects users and sessions together. |
| `AUDIO_STORAGE_PATH` | Private audio directory, resolved from the project working directory when relative. Blank values fall back to `storage/audio`. |
| `MAX_AUDIO_FILE_SIZE_MB` | Maximum application-level size of one upload. Invalid or blank values use 50 MB. |
| `BODY_SIZE_LIMIT` | Request-body limit used by the production Node adapter. It must exceed the audio limit enough to allow multipart overhead. |
| `SESSION_COOKIE_NAME` | Name of the private authentication cookie. |
| `SESSION_DURATION_DAYS` | Session and cookie lifetime. Valid values are whole days from 1 through 30; the default is 7. |
| `MONGODB_URI` | MongoDB connection string used only by the M1 connection infrastructure and connectivity check. Never commit a credential-bearing URI. |
| `MONGODB_DB_NAME` | Development MongoDB database name. |
| `MONGODB_TEST_DB_NAME` | Isolated MongoDB test database name. It must start with `audio_library_test_` and differ from the development name. |

Keep production secrets and deployment-specific paths in the untracked `.env`
file or the hosting environment. Reverse proxies and hosting platforms may
apply independent request-size limits.

## Authentication and authorization

Registration and login use SvelteKit server form actions. Validation is
repeated on the server, passwords never return in form data, and passwords are
hashed with a fresh bcrypt salt. Inputs that bcrypt would truncate after 72
UTF-8 bytes are rejected.

A session starts with a cryptographically random 32-byte token. The browser
receives the raw token only in an HttpOnly, SameSite=Lax cookie; the database
stores its SHA-256 hash. Production cookies are also Secure. The server hook
validates the session for every request and deletes expired or invalid session
cookies safely.

`/account`, `/upload`, and every `/my-tracks` route require authentication.
Signed-out visitors are redirected to login with a validated local return
path. Login and registration redirect an already authenticated user home, and
logout accepts POST only.

The root layout receives only the signed-in username. The account page uses a
separate projection containing the authenticated user's own username, email,
and join date, without the internal user UUID. Public and owner-management
page data never includes internal track UUIDs, owner IDs or emails, storage
keys, session data, or physical paths.
Email may be returned only on the authenticated user's own account page.

## Upload and private storage

The protected upload form accepts:

- a non-empty MP3, WAV, or OGG file
- required title and artist values, each up to 120 characters
- optional integer BPM from 20 through 300
- an optional musical key and genre from centralized allowlists
- an optional description up to 2,000 characters

Accepted extension and declared MIME-type combinations are:

| Format | Extension | MIME types |
| --- | --- | --- |
| MP3 | `.mp3` | `audio/mpeg` |
| WAV | `.wav` | `audio/wav`, `audio/x-wav`, `audio/wave`, `audio/vnd.wave` |
| OGG | `.ogg` | `audio/ogg` |

The server validates every field even when browser constraints are bypassed.
Audio is stored outside `static` under `AUDIO_STORAGE_PATH`. The physical
filename is a random version 4 UUID plus the validated lowercase extension;
the original filename is retained only as metadata and never constructs a
path.

Storage paths are checked lexically and canonically to remain under the
configured root. Regular files are opened with private filesystem
permissions. The upload flow writes the file before inserting metadata; if the
database insert fails, it removes the new file. Successful uploads are public
and use Post/Redirect/Get to reach the numeric public track URL.

## Public browsing, search, and filters

`/tracks` and `/tracks/{publicId}` are public. Their explicit view model
contains only the numeric route ID, display metadata, file size, owner
username, and timestamps. Private, invalid, missing, and unauthorized records
do not expose their internal existence.

The filter form uses GET, making results refreshable, bookmarkable, shareable,
and usable without JavaScript.

| Parameter | Behavior |
| --- | --- |
| `q` | Trimmed partial match across title, artist, and description; maximum 100 characters. |
| `bpmMin` | Inclusive minimum BPM from 20 through 300. |
| `bpmMax` | Inclusive maximum BPM from 20 through 300. |
| `musicalKey` | Exact value from the musical-key allowlist. |
| `genre` | Exact value from the genre allowlist. |
| `sort` | `newest`, `oldest`, `title_asc`, `bpm_asc`, or `bpm_desc`. |

Search values are parameter-bound. `%`, `_`, and backslash are escaped as
literal SQL `LIKE` text, and the public visibility condition is grouped
separately from the title/artist/description OR expression. BPM filters
exclude unspecified BPM values. BPM sorting keeps unspecified values last in
both directions, and every sort has a public-ID tie-breaker for stable results.

Invalid filter values produce accessible validation messages and no misleading
query. Submitted safe values remain visible, and Reset filters returns exactly
to `/tracks`.

## Streaming, seeking, and downloads

The root layout owns one audio element and a compact bottom player, so selected
audio, seek position, duration, volume, and play/pause state survive internal
SvelteKit navigation. Browse cards, public track details, and public entries in
My Tracks all control that same player. Its client state contains only the
numeric public track ID, title, artist, stream URL, and public details URL.

The global player requests:

```text
GET /api/tracks/{publicId}/stream
```

A full response uses status 200. A valid single byte range uses status 206
with exact `Content-Range`, `Content-Length`, and `Accept-Ranges: bytes`
headers. Open-ended and suffix ranges are supported. Malformed, multiple,
reversed, or unsatisfiable ranges return 416 with
`Content-Range: bytes */TOTAL`.

Downloads use:

```text
GET /api/tracks/{publicId}/download
```

The response streams the same private file with
`Content-Disposition: attachment`. It includes a sanitized ASCII fallback and
an RFC-compatible UTF-8 `filename*` derived from the original filename. Path
components and control characters are removed, and generated storage names
are never returned.

Both endpoints validate public visibility, stored filenames, canonical path
containment, and regular-file status. Responses use `private, no-store` and
`X-Content-Type-Options: nosniff`. Expected missing files return a safe 404;
unexpected failures return generic text and sanitized log metadata.

## My Tracks, editing, and deletion

`/my-tracks` lists only the authenticated owner's tracks, including existing
public and private records. Visibility is a read-only text badge. Public
tracks link to their public detail pages; private tracks do not.

Owners can edit title, artist, BPM, musical key, genre, and description.
Repository reads and updates match both the numeric public ID and the owner ID
from the authenticated session. Submitted owner IDs, visibility, storage keys,
or alternate track IDs have no effect. Editing preserves audio bytes,
filenames, ownership, visibility, creation time, and both internal and public
identities.

Deletion has a dedicated confirmation page and requires POST. For an existing
regular file, the service:

1. validates and moves the file to a server-generated quarantine name inside
   the same storage directory;
2. deletes the row with the authenticated owner condition;
3. removes the quarantined file;
4. restores the original generated filename when a database or final-unlink
   failure permits recovery.

An already missing physical file is treated as cleaned so its owned row can
still be removed. Non-files, symbolic links, unsafe paths, and non-owned rows
fail closed. Successful updates and deletions redirect with HTTP 303, so
refreshing the result page does not repeat a mutation.

## Database and migrations

The schema and five historical SQL migrations are committed under `drizzle/`.
Apply them to a new or existing database with:

```powershell
npm run db:migrate
```

Generate a new migration only after an intentional schema change:

```powershell
npm run db:generate
```

Open Drizzle Studio for local inspection with:

```powershell
npm run db:studio
```

The current migrations create users, hashed sessions, track metadata and
ownership, public/private visibility, storage references, metadata constraints,
and the numeric public route ID while preserving the server-only track UUID.

### MongoDB migration M1–M3

The MongoDB migration is being introduced in phases. M1 adds the official
MongoDB Node.js driver, validated environment settings, typed document and
collection definitions, a cached server-only client, and idempotent index
creation. The application still uses SQLite and Drizzle for all runtime data;
no repository or stored data has been migrated.

M2 adds a focused user-repository contract with SQLite and MongoDB
implementations. SQLite remains the safe application default. Registration
conflict checks, password-authentication lookup, and account lookup use the
SQLite implementation through the contract; atomic user-and-session creation
remains one SQLite transaction. MongoDB user operations are
integration-tested only against a unique database derived from
`MONGODB_TEST_DB_NAME`. That name must differ from `MONGODB_DB_NAME` and start
with `audio_library_test_`.

M3 adds matching SQLite and MongoDB session repositories and one unified auth
selector. `DATABASE_BACKEND=sqlite` remains the safe default.
`DATABASE_BACKEND=mongodb` selects MongoDB for both users and sessions; mixed
auth backends are forbidden. MongoDB auth requires Atlas, a replica set, or a
compatible sharded deployment because registration uses a transaction to
create the user and initial session atomically. There is no non-atomic fallback.

Tracks and audio metadata remain SQLite-backed regardless of the selected auth
backend. Real users and sessions are not migrated yet. A final switch to
MongoDB auth will invalidate existing SQLite login cookies; users should sign
in again rather than copying active session tokens. Full application cutover
is not complete.

With all three MongoDB environment variables configured, verify connectivity,
database selection, and indexes without reading or writing application
documents:

```powershell
npm run db:mongodb:check
```

MongoDB Compass is an optional desktop client for inspecting a MongoDB server;
it is not the server itself and is not required by the application.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server. |
| `npm run build` | Create the production Node build. |
| `npm run preview` | Preview the production build through Vite. |
| `npm run check` | Run Svelte and TypeScript diagnostics. |
| `npm run check:watch` | Run diagnostics in watch mode. |
| `npm run test` | Run all Vitest tests once. |
| `npm run test:watch` | Run Vitest in watch mode. |
| `npm run test:integration` | Run 21 isolated public media and upload HTTP checks. |
| `npm run test:integration:phase5` | Run 26 isolated search, filter, sort, and media checks. |
| `npm run test:integration:phase6` | Run 31 isolated owner-management, privacy, and regression checks. |
| `npm run verify:clean-clone` | Verify install, fresh migrations, diagnostics, tests, build, production startup, and cleanup from an isolated release-candidate copy. |
| `npm run db:migrate` | Apply committed migrations. |
| `npm run db:generate` | Generate a migration from an intentional schema change. |
| `npm run db:studio` | Open Drizzle Studio. |
| `npm run db:mongodb:check` | Safely check the configured MongoDB connection, selected development database, and M1 indexes. |
| `npm run test:mongodb:users` | Run the isolated M2 MongoDB user-repository integration checks and remove their uniquely owned test database. |
| `npm run test:mongodb:auth` | Verify M3 MongoDB transactions, users-plus-sessions authentication behavior, privacy, and isolated cleanup. |

There is no separate lint script. `npm run check` is the enforced Svelte and
TypeScript static-analysis command.

## Testing

The Vitest suite uses in-memory SQLite databases and disposable filesystem
directories. It covers authentication, validation, safe projections, query
parsing and SQL escaping, deterministic repository behavior, private path
containment, file streaming, upload rollback, owner scoping, immutable
metadata, deletion quarantine and recovery, and sanitized failures.

The three HTTP controllers start exactly one owned Vite process on an isolated
port, use copied database and separate audio storage, enforce bounded startup
and overall timeouts, fully read media responses, and verify process, port,
temporary-directory, and real-runtime postconditions during cleanup. The
search and owner-management controllers are maintainer regression suites that
seed only synthetic fixtures into a temporary database copy. They compare
normalized snapshots of every pre-existing user, session, and track row, plus
hash-based snapshots of the real database and audio storage, without depending
on any real title, artist, username, or other row value.

The clean-clone verification uses Git only for read-only enumeration. It copies
the working-tree versions of tracked files that still exist and untracked,
non-ignored release files into a temporary candidate without copying a `.git`
directory. It never runs `git add` and does not modify the source repository
index or object database. The verifier excludes ignored `.env`, database,
audio, dependency, build, and instruction files; runs `npm ci`; copies
`.env.example` to `.env`; applies migrations to a new empty SQLite database;
runs checks, tests, and the production build; probes `/` and `/tracks` through
the built Node server; and removes its process, port listener, and temporary
directory.

Run the complete browser checklist in [MANUAL_TESTS.md](MANUAL_TESTS.md).

## Project structure

```text
docs/screenshots/           prepared location for safe product screenshots
drizzle/                    versioned SQLite migrations and metadata
scripts/                    bounded HTTP and clean-clone verification controllers
src/
  lib/
    components/             reusable UI
    constants/              musical-key and genre allowlists
    server/
      auth/                 passwords, sessions, repository, guards, and logging
      db/                   Drizzle connection and schema
      tracks/               validation, storage, search, media, and owner services
  routes/
    account/                protected account details
    api/tracks/             public streaming and download endpoints
    my-tracks/              owner list, metadata editing, and deletion
    tracks/                 public list and detail pages
    upload/                 protected multipart upload
storage/audio/              private runtime audio; contents are ignored by Git
```

## Current limitations

- Upload parsing uses `request.formData()` and storage uses
  `File.arrayBuffer()`, so complete upload bytes are buffered in memory.
- Extension and declared MIME validation does not inspect file signatures,
  decode codecs, scan for malware, transcode, or guarantee browser playback.
- Browser support varies for the codecs stored inside WAV and OGG containers.
- Local SQLite plus local filesystem storage is intended for a local or
  single-node deployment unless shared infrastructure is added.
- SQLite's built-in case folding is primarily ASCII-aware, so non-ASCII
  case-insensitive search behavior is limited by SQLite.
- Streaming supports one byte range per request, not multipart ranges.
- SQLite and the filesystem cannot share one atomic transaction. Deletion uses
  quarantine and recovery, but an exceptional double failure can leave an
  unreferenced file for operator cleanup.
- New uploads are public. Existing private records are owner-visible, but
  visibility is read-only.
- Audio replacement, visibility controls, pagination, playlists, comments,
  ratings, recommendations, automatic BPM/key analysis, waveform generation,
  transcoding, and administration features are not implemented.

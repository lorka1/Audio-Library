# Audio Library

Audio Library is a SvelteKit application for uploading, browsing, searching,
streaming, downloading, managing privately stored audio, and organizing tracks
in private user-owned playlists. MongoDB is the
only persistence backend. Audio, optional cover-image, and optional playlist-image bytes remain in private
filesystem storage; MongoDB stores users, hashed sessions, track metadata,
optional cover metadata, ownership, public route IDs, and private storage
references. Playlist membership stores only internal track references; audio and
track metadata are never duplicated into a playlist.

## Requirements

- Node.js `^22.12.0` or `>=24`
- npm `>=10`
- MongoDB reachable as a transaction-capable replica set (a local single-node
  replica set is the supported self-hosted setup)

Registration creates a user and initial session in one transaction. A
standalone MongoDB server without transaction support is rejected.

## Technology stack

- SvelteKit and Svelte with the Node adapter;
- TypeScript and Vite;
- MongoDB as the only persistence service;
- private local filesystem storage for audio and optional cover-image bytes;
- separate private filesystem storage for owner-only playlist-image bytes.

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
| `MONGODB_URI` | Private connection string for the transaction-capable deployment; the local production URI includes `replicaSet=rs0`. Never commit credentials. |
| `MONGODB_DB_NAME` | Application database name. |
| `AUDIO_STORAGE_PATH` | Private filesystem root for audio bytes. Optional cover images are stored in its private `covers/` subdirectory. |
| `MAX_AUDIO_FILE_SIZE_MB` | Application upload limit. |
| `COVER_IMAGE_MAX_SIZE_MB` | Optional cover-image upload limit. |
| `PLAYLIST_IMAGE_STORAGE_PATH` | Separate private filesystem root for owner-only playlist artwork. |
| `PLAYLIST_IMAGE_MAX_SIZE_MB` | Optional playlist-image upload limit. |
| `BODY_SIZE_LIMIT` | Adapter request limit. It must cover the larger of audio plus track cover, or playlist image, plus 1 MiB of multipart/form-data overhead. |
| `SESSION_COOKIE_NAME` | HttpOnly session cookie name. |
| `SESSION_DURATION_DAYS` | Session lifetime from 1 through 30 days. |

Production additionally supplies `HOST`, `PORT`, and an HTTPS `ORIGIN` through
its private process environment. Production configuration is validated at
startup and does not rely on development defaults.

Start development:

```powershell
npm run dev
```

## MongoDB initialization

Initialize a new database explicitly:

```powershell
npm run db:mongodb:init
```

Server startup uses one shared server-only client and refuses to serve traffic
unless the writable PRIMARY, transaction topology, collections, exact indexes,
public-ID counter, cookie/request limits, and private media storage are valid.
Index initialization is separate from read-only startup/readiness verification:

- unique usernames and emails;
- unique session token hashes, session ownership, and expiration;
- unique track public IDs and storage keys;
- owner/public query paths, BPM, musical key, and genre;
- unique opaque playlist public IDs plus owner/update and owner/public-ID lookups;
- unique playlist/track membership, deterministic insertion order, and
  track-deletion cleanup lookup.

## Features

- registration, login, logout, session validation, and session expiration;
- transactional user/session creation;
- public Browse with literal substring search;
- inclusive BPM bounds, key and genre filters, and combined filters;
- newest, oldest, title ascending/descending, and BPM ascending/descending
  ordering with deterministic tie handling;
- public numeric detail URLs;
- full streaming, byte Range seeking, invalid Range handling, and downloads;
- optional JPEG, PNG, or WebP cover images, limited by
  `COVER_IMAGE_MAX_SIZE_MB` (5 MB in `.env.example`), with local fallback
  artwork;
- safe public cover delivery through `GET /api/tracks/[id]/cover`;
- private owner dashboard, metadata editing, and deletion;
- owner-safe cover retention, replacement, and removal;
- quarantine-based audio and cover deletion with database-failure restoration;
- private playlists with create, rename, description edit, delete, detail,
  add-track, and remove-track behavior;
- accessible-track enforcement: public tracks and the current owner's private
  tracks may be added, while duplicate membership is idempotently prevented;
- Add to playlist controls on Browse, public track detail, and My Tracks;
- safe public, owner, account, navigation, and server-only projections.

Removing a track from a playlist does not delete the track. Deleting a track
removes every membership referencing it in the same MongoDB transaction as the
track metadata deletion. Playlist Phase P1 is private and owner-only: public
playlists, sharing, collaboration, reordering, recommendations, and playlist
playback queues are intentionally not implemented.

Route modules do not select or construct persistence implementations. Central
server-only persistence modules provide the MongoDB repositories.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server. |
| `npm run check` | Run Svelte and TypeScript diagnostics. |
| `npm run build` | Create the production Node build. |
| `npm start` | Start the hardened production listener with graceful shutdown. |
| `npm run preview` | Preview the production build through Vite. |
| `npm run db:mongodb:init` | Explicitly initialize a new database's indexes and counter. |

## Production

Build and start the adapter-node output:

```powershell
npm run build
$env:HOST='127.0.0.1'
$env:PORT='3000'
$env:ORIGIN='https://your-host.example'
npm start
```

`GET /api/health/live` checks only the process. `GET /api/health/ready`
performs bounded read-only MongoDB/index/counter and private-storage checks.
Neither exposes contents, paths, counts, credentials, or identifiers. SIGINT
and SIGTERM stop the listener, allow bounded in-flight completion, then close
the application-owned listener and shared MongoDB client once.

Keep `AUDIO_STORAGE_PATH`, including its `covers/` subdirectory, on persistent
private storage and never expose it through a static file server. MongoDB and
private-media backup and recovery are deployment responsibilities outside the
application runtime. Never commit backup data or `.env`. The complete
same-computer Windows runbook is in
[`docs/operations.md`](docs/operations.md).

## Privacy and storage

Browser payloads never receive password hashes, raw or hashed session tokens,
internal user/track/playlist/playlist-item identifiers, owner IDs, audio or cover storage keys,
absolute paths, database names, connection strings, or private audit
information. Public and owner-facing track models expose only a safe cover URL
or cover state.

Operational logs are structured and limited to safe categories, codes,
request/correlation IDs, route categories, status, and duration. Raw errors,
request bodies, identities, filenames, storage keys, private paths, cookies,
authorization headers, documents, URIs, and migration fingerprints are omitted.

Audio and cover-image bytes are not stored in MongoDB or GridFS. Cover images
are optional and limited to JPEG, PNG, or WebP; the server validates both MIME
type and filename extension. `GET /api/tracks/[id]/cover` serves an eligible
cover without exposing its private filename or path, while the UI uses local
fallback artwork when no cover is available.

Optional playlist artwork uses the same validated JPEG/PNG/WebP signature and
contained-path conventions under `PLAYLIST_IMAGE_STORAGE_PATH`. MongoDB stores
only generated storage metadata; owner-facing models expose only the protected
`GET /api/playlists/[publicId]/image` URL. Replacement cleans the previous file
only after persistence succeeds, and deletion quarantines/restores artwork
around the playlist transaction.

Upload and cover-replacement filesystem writes use compensating cleanup.
Deletion quarantines both the audio and cover where present, and restores them
when database deletion fails. Existing tracks without cover metadata remain
valid and immediately use the fallback artwork.

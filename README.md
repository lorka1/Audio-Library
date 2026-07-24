# Audio Library

Audio Library is a SvelteKit application with a local SQLite database, secure
account sessions, and private audio storage. Phase 3 provides registration,
login, logout, persistent authentication, a protected account page, and
authenticated MP3, WAV, and OGG uploads with server-validated metadata.

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

```dotenv
DATABASE_URL=./data/app.db
AUDIO_STORAGE_PATH=storage/audio
MAX_AUDIO_FILE_SIZE_MB=50
BODY_SIZE_LIMIT=55M
SESSION_COOKIE_NAME=audio_library_session
SESSION_DURATION_DAYS=7
```

- `DATABASE_URL` is the path to the local SQLite file and is required.
- `AUDIO_STORAGE_PATH` is the private audio directory. Relative values are
  resolved from the project working directory. It defaults to `storage/audio`
  when missing or blank.
- `MAX_AUDIO_FILE_SIZE_MB` is the application-level limit for one audio file.
  It defaults to 50 MB when missing, blank, non-numeric, non-finite, zero, or
  negative. The byte calculation uses 1,024 × 1,024 bytes per configured MB.
- `BODY_SIZE_LIMIT` controls the request-body limit in the production
  adapter-node server. The provided value is 55M so a 50 MB file plus multipart
  form overhead can reach application validation. It must remain higher than
  `MAX_AUDIO_FILE_SIZE_MB`; raise both deliberately if larger uploads are
  required. A reverse proxy or hosting platform may impose another independent
  request limit.
- `SESSION_COOKIE_NAME` is the name of the private authentication cookie.
- `SESSION_DURATION_DAYS` is the session and cookie lifetime. The default is
  seven days, and configured values must be whole numbers from 1 through 30.

All storage and session configuration is read only by server-side code.

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
only in an HttpOnly, SameSite=Lax cookie. The database stores only the token's
SHA-256 hash, so the database never contains a usable session token. Cookies
are marked Secure outside development and expire with the database session.

`src/hooks.server.ts` validates the cookie on every request and populates
`App.Locals` with safe user and session objects. Password hashes and session
token hashes are never included in locals or layout data.

The `/account` and `/upload` pages require authentication. Signed-out visitors
are sent to login and returned to the protected page after successful
authentication. Login and registration pages redirect authenticated users
home. Logout is a POST-only operation that removes the database session and
clears the cookie.

## Audio uploads

Open `/upload` while signed in. The native multipart form works without
client-side JavaScript and accepts:

- an audio file
- required title and artist values, each limited to 120 characters
- optional integer BPM from 20 through 300
- an optional musical key and genre from the provided lists
- an optional description limited to 2,000 characters

The application accepts only these matching filename-extension and declared
MIME-type pairs:

| Format | Extension | Accepted MIME type |
| --- | --- | --- |
| MP3 | `.mp3` | `audio/mpeg` |
| WAV | `.wav` | `audio/wav`, `audio/x-wav`, `audio/wave`, `audio/vnd.wave` |
| OGG | `.ogg` | `audio/ogg` |

Extension and MIME comparisons are normalized for case and surrounding MIME
whitespace. A supported extension with a MIME type belonging to another format
is rejected. The browser's file `accept` attribute is only a usability hint;
the server repeats all validation.

The default application limit is 50 MB per file. Empty files, files over the
configured limit, missing filenames, unsupported formats, and mismatched
extension/MIME pairs are rejected before file bytes are written.

### Storage and consistency

Audio bytes are stored privately under `AUDIO_STORAGE_PATH`, which defaults to
`storage/audio`. This directory is outside `static` and is not directly
addressable by a public URL. SQLite stores track metadata only; it never stores
the audio file contents.

The original filename is retained only as metadata. The physical
`storageKey` is a random version 4 UUID followed only by the validated lowercase
extension, for example:

```text
550e8400-e29b-41d4-a716-446655440000.mp3
```

The generated name is checked before its final path is resolved inside the
configured storage root. Uploads do not use the original filename to construct
a filesystem path.

The upload service coordinates the filesystem and SQLite in this order:

1. Require the authenticated user and take the owner ID from `event.locals`.
2. Validate all metadata and the audio file on the server.
3. Create the private storage directory when needed and write the file under
   its exclusive generated name.
4. Insert the track metadata with the actual byte count, validated MIME type,
   generated storage key, and authenticated owner ID.
5. If the database insert fails, remove the newly written file. Missing files
   during rollback are treated as already cleaned up.
6. On success, redirect with HTTP 303 to `/upload?success=1`, which displays
   `Audio track uploaded successfully.` and an empty form.

Unexpected failures return a generic message without exposing SQL, session
data, internal filenames, or absolute storage paths.

### Storage and Git

`storage/audio/.gitkeep` keeps the empty directory structure in the repository.
`.gitignore` excludes `storage/audio/*` and then explicitly retains
`.gitkeep`, so uploaded audio content is not added to Git.

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

Phase 2 added the unique `sessions.token_hash` column. Phase 3 adds BPM,
musical-key, and genre metadata to `tracks`, makes artist required, and adds a
database check for nullable BPM values in the 20–300 range. Existing migrations
remain unchanged.

Inspect users, sessions, and track metadata with:

```powershell
npm run db:studio
```

## Manual upload verification

1. Apply migrations and start the development server:

   ```powershell
   npm run db:migrate
   npm run dev
   ```

2. Register or log in, open `/upload`, and submit a small test MP3, WAV, or OGG
   file with valid metadata.
3. Confirm the success message appears and refreshing the success page does not
   submit another upload.
4. Inspect the private files:

   ```powershell
   Get-ChildItem -LiteralPath storage/audio
   ```

5. Run `npm run db:studio` and confirm that the corresponding `tracks` row has
   the signed-in user's `owner_id`, the original filename, generated
   `storage_key`, validated MIME type, actual byte size, and submitted metadata.

Use disposable test audio and account data. The complete browser checklist is
in `MANUAL_TESTS.md`.

## Structure

```text
drizzle/                    versioned SQL migrations
src/
  lib/
    components/             shared UI components
    constants/              centralized musical keys and genres
    server/
      auth/                 validation, password, session, repository, and guards
      db/                   SQLite connection, Drizzle schema, and database types
      tracks/               upload validation, private files, service, and repository
    types/                  shared client-safe TypeScript types
  routes/
    account/                protected account page
    login/                  login form and action
    logout/                 POST-only logout endpoint
    register/               registration form and action
    upload/                 protected multipart upload form and action
storage/audio/              private runtime audio storage; contents ignored by Git
```

## Testing

Run the automated unit tests with:

```powershell
npm run test
```

The suite covers authentication validation, password hashing, session token
hashing, upload-size configuration, audio extension/MIME mappings, generated
stored filenames, safe storage paths, temporary file writing and cleanup,
authenticated track insertion order, and filesystem rollback after database
failure. Filesystem tests use temporary directories rather than
`storage/audio`.

Browser-level checks for authentication, upload validation, persistence,
rollback, no-JavaScript operation, and responsive navigation are listed in
`MANUAL_TESTS.md`.

## Security and resource limitations

Extension and declared MIME-type validation is not a complete verification of
file contents. Phase 3 does not inspect file signatures, decode audio, run
ffmpeg, or perform antivirus scanning. Deployments that accept untrusted public
uploads should add content inspection and malware controls before exposing
files to other users.

The current multipart action uses `request.formData()`, and file storage uses
`File.arrayBuffer()` before writing. Upload bytes are therefore buffered in
memory rather than streamed to disk. Memory requirements increase with file
size and concurrent uploads; keep conservative request limits in production.

## Phase 3 boundary

Phase 3 intentionally does not include playback, an HTML audio player,
streaming, HTTP Range requests, download, public track lists, track detail
pages, search, BPM/key/genre filters, a My Tracks page, metadata editing, file
replacement, deletion, automatic BPM or key analysis, comments, playlists, or
ratings. These capabilities remain reserved for later phases.

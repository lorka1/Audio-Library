# Audio Library

Audio Library is a SvelteKit application with a local SQLite database, secure
account sessions, private audio storage, and public track delivery. Phase 6
adds an authenticated My Tracks area, owner-only metadata editing, and
confirmed safe deletion while preserving the public search, filtering,
streaming, and download behavior from Phases 4 and 5.

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
| `npm run test:integration` | Runs the bounded isolated Phase 4 HTTP integration test |
| `npm run test:integration:phase5` | Runs the bounded isolated Phase 5 search/filter/sort HTTP integration test |
| `npm run test:integration:phase6` | Runs the bounded isolated Phase 6 owner-management HTTP integration test |
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

The `/account`, `/upload`, and all `/my-tracks` pages require authentication.
The `/tracks` list, public track details, streaming, and download routes do
not. Signed-out visitors are sent to login and returned to the protected page
after successful authentication. Login and registration pages redirect
authenticated users home. Logout is a POST-only operation that removes the
database session and clears the cookie.

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
6. On success, redirect with HTTP 303 to `/tracks/{publicId}?uploaded=1`.
   Refreshing the detail page repeats only the GET request and never repeats
   the upload.

Unexpected failures return a generic message without exposing SQL, session
data, internal filenames, or absolute storage paths.

## Public tracks

Anyone can open `/tracks` to search, filter, and sort public tracks. Each card
shows the title, artist, BPM, musical key, genre, owner username, and upload
date. Optional values use `Not specified`. The page distinguishes an empty
public library from a valid search or filter combination with no matches.

The filter form uses a normal GET request and works without client-side
JavaScript. Its URL is the source of truth, so filtered results can be
refreshed, bookmarked, or shared. Supported query parameters are:

| Parameter | Behavior |
| --- | --- |
| `q` | Trimmed partial search across title, artist, and description; maximum 100 characters |
| `bpmMin` | Optional inclusive minimum BPM, as a canonical integer from 20 through 300 |
| `bpmMax` | Optional inclusive maximum BPM, as a canonical integer from 20 through 300 |
| `musicalKey` | Optional exact value from the centralized musical-key list |
| `genre` | Optional exact value from the centralized genre list |
| `sort` | `newest`, `oldest`, `title_asc`, `bpm_asc`, or `bpm_desc` |

`newest` is the default and is normally omitted from canonical URLs. Unknown
sort values safely fall back to `newest`. Unknown unrelated parameters are
ignored. BPM text with decimals, signs, leading zeroes, values outside
20–300, or a minimum greater than the maximum produces an accessible
validation message and no misleading database query. Other valid submitted
fields remain visible in the form.

Text matching is parameterized and case-insensitive for SQLite-supported
case folding. `%`, `_`, and backslash are escaped and treated as literal
characters rather than SQL `LIKE` wildcards; quotes remain bound values.
Ordinary Unicode input is retained, with non-ASCII case-insensitive behavior
limited to what the bundled SQLite implementation supports.

Minimum and maximum BPM comparisons are inclusive. Tracks with a null BPM do
not match an active BPM filter. Without a BPM filter they remain eligible and,
for both BPM sort directions, appear after all numeric BPM values. Every sort
uses a fixed allowlisted SQL expression and a numeric public-ID tie-breaker so
ordering is deterministic.

Every list query independently requires `visibility = public` and selects the
same explicit safe public fields used in Phase 4. Search terms cannot weaken
visibility enforcement. Internal UUIDs, storage keys, physical paths, owner
IDs/emails, and session data are not part of page data.

`/tracks/{publicId}` shows one public track, its safe metadata, native audio
controls, and a download link. Invalid positive-integer IDs, missing records,
and private records all return the same safe 404. Page data is built from an
explicit public view model; it does not serialize database rows containing the
internal UUID, owner ID or email, storage key, original filename, password
hash, session information, or physical path.

The numeric `public_id` is an auto-incrementing route identifier. The original
UUID `tracks.id` remains unique and server-only, so adding public URLs does not
change existing track identity or ownership.

### Audio streaming and seeking

The native player reads:

```text
GET /api/tracks/{publicId}/stream
```

The endpoint looks up only public records, derives the generated stored
filename from the database, validates it, and opens it only inside the
configured audio root. Files stay outside `static`, so no filename or path can
be supplied directly in a URL.

Without a `Range` header, the endpoint streams the whole file with status 200,
the actual physical `Content-Length`, `Accept-Ranges: bytes`, and a validated
audio `Content-Type`. A valid single byte range returns status 206 with the
selected bytes and an exact `Content-Range`. Open-ended and suffix ranges are
supported. Malformed, multiple, reversed, or unsatisfiable ranges return 416
with `Content-Range: bytes */TOTAL`.

Seeking works because the browser sends a new byte-range request for the
position selected in the native `<audio>` controls. The server uses a Node
file stream converted to a Web response stream; it does not load the complete
audio file into application memory.

### Downloads

Downloads use:

```text
GET /api/tracks/{publicId}/download
```

The server streams the same private physical file and sets
`Content-Disposition: attachment`. The header includes a quoted, injection-safe
ASCII fallback and an RFC-compatible UTF-8 `filename*` value derived from the
original user-facing filename. Control characters and path components are
removed. The UUID stored filename and storage path are never used as the
download name or returned to the client.

Both media endpoints use conservative `private, no-store` caching and
`X-Content-Type-Options: nosniff`. A missing physical file or non-regular file
returns a safe 404. Unexpected storage failures return a generic response and
sanitized server log metadata.

## My Tracks and owner management

Signed-in users can open `/my-tracks` to see only tracks owned by their
authenticated account. The page includes both public and private tracks,
orders them newest first, and labels visibility as read-only. Public tracks
link to their public detail page; private tracks do not. An account with no
uploads receives a clean empty state and a link to `/upload`.

Owner-management page data uses an explicit safe model containing only the
numeric public ID and display metadata needed by the UI. It never includes the
internal track UUID, owner ID or email, generated storage key, physical path,
or session data. The repository receives the owner ID only from
`event.locals.user.id`. Owner-management loads and the actual `UPDATE` and
`DELETE` statements match both `publicId` and that authenticated owner ID.
Invalid, missing, and non-owned management URLs therefore use the same safe
404 response.

### Metadata editing

`/my-tracks/{publicId}/edit` provides a native SvelteKit form action that works
without client-side JavaScript. Owners may edit title, artist, BPM, musical
key, genre, and description.

The audio file, original and stored filenames, visibility, ownership, public
ID, internal UUID, creation time, MIME type, and byte size are not editable.
The form reuses upload metadata validation without requiring another audio
file. Invalid submissions preserve safe form values, display field-level
errors, and do not update the row or touch the file.

A successful owner-scoped update changes only editable metadata and
`updatedAt`, then redirects with HTTP 303 to `/my-tracks?updated=1`. The query
flag is allowlisted, and refreshing that URL performs only a GET.

### Confirmed deletion and consistency

`/my-tracks/{publicId}/delete` is an explicit owner-only confirmation page.
Opening it with GET never deletes anything. Permanent deletion requires its
POST form and redirects with HTTP 303 to `/my-tracks?deleted=1` after success.

Deletion validates the server-only generated filename, enforces lexical and
canonical containment inside the configured storage root, and rejects
symbolic links and non-files. When a regular file exists, the service renames
it to a server-generated quarantine name in the same storage directory,
performs an owner-scoped row deletion, and then unlinks the quarantined file.
If the database operation fails, it attempts to restore the original file.
A file that is already missing is treated as already cleaned up, so the owned
row can still be removed.

SQLite and the filesystem do not provide a shared transaction, so deletion
does not claim perfect atomicity. If the final unlink fails after the row was
deleted, the service attempts to restore the file to its original generated
name, removes no unrelated data, returns a generic failure, and logs only
sanitized error metadata. In that rare case an unreferenced owner audio file
may remain for operator cleanup, but no database row points to missing audio
and no temporary quarantine name is exposed. If restoring after a database or
unlink failure also fails, the response remains generic and the sanitized
server log records the recovery failure.

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

Phase 2 added the unique `sessions.token_hash` column. Phase 3 added BPM,
musical-key, and genre metadata to `tracks`, made artist required, and added a
database check for nullable BPM values in the 20–300 range. Migration `0003`
changed new uploads to public visibility by default. Phase 4 migration `0004`
adds the numeric public route ID while preserving the existing internal UUID,
owner, metadata, visibility, and stored audio reference. Historical migrations
remain unchanged. Phase 6 uses the existing metadata, ownership, visibility,
and timestamp columns, so it adds no migration.

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
3. Confirm the browser redirects to `/tracks/{publicId}?uploaded=1`, the
   success message appears, and refreshing the detail page does not submit
   another upload.
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
      tracks/               public queries/models, IDs, ranges, downloads, private files, upload, and repository
    tracks-query.ts         client-safe query types, canonical URLs, summaries, and result counts
    types/                  shared client-safe TypeScript types
  routes/
    account/                protected account page
    login/                  login form and action
    logout/                 POST-only logout endpoint
    register/               registration form and action
    tracks/                 public list and detail pages
    my-tracks/              owner list, metadata edit, and deletion confirmation
    api/tracks/             public-ID stream and download endpoints
    upload/                 protected multipart upload form and action
scripts/                    bounded isolated integration controller
storage/audio/              private runtime audio storage; contents ignored by Git
```

## Testing

Run the automated unit tests with:

```powershell
npm run test
```

The suite covers authentication, upload validation and rollback, public-model
mapping, positive-integer track IDs, deterministic formatting, HTTP byte
ranges, download filename encoding, generated stored filenames, path
containment, Node-to-Web file streaming, Phase 5 query parsing, literal
SQL-LIKE escaping, canonical query strings, result summaries, repository
filter combinations, safe public projection, and every stable sort. Phase 6
coverage adds owner-safe projections, owner-scoped reads and mutations,
metadata validation, immutable-field preservation, quarantine/restore/finalize
behavior, missing files, unsafe paths, non-files, symbolic links, database
rollback, final-unlink failure, concurrent deletion, and sanitized failures.
Repository tests use isolated in-memory SQLite databases, and filesystem tests
use temporary directories rather than `storage/audio`.

Run the bounded server-level Phase 4 integration checks with:

```powershell
npm run test:integration
```

The controller creates a temporary copied database and a separate temporary
audio directory, selects an isolated port, enforces 60-second startup and
overall timeouts, prints startup logs on failure, and always terminates its own
Vite process in cleanup. It verifies list/detail privacy, full and partial
streaming, 416 responses, downloads, upload redirects, and refresh behavior.
It also verifies that the real database and `storage/audio` remain unchanged.

Run the separately bounded Phase 5 integration checks with:

```powershell
npm run test:integration:phase5
```

This controller applies the same isolation and cleanup rules while seeding
diverse synthetic public and private tracks. Its 26 HTTP checks cover default
public visibility, all searchable fields, case-insensitive and literal
wildcard matching, inclusive BPM bounds, exact key/genre matching, combined
filters, all five sort modes, deterministic null-BPM placement, invalid-query
rendering, form state, the `/tracks` reset URL, response privacy, and stream,
Range, and download regression behavior. It also compares the complete real
`Party about you` row before and after the run.

Run the bounded Phase 6 owner-management integration checks with:

```powershell
npm run test:integration:phase6
```

The Phase 6 controller uses two synthetic users, a copied temporary database,
separate temporary audio storage, and a random port. Its 31 numbered HTTP
checks cover My Tracks authentication and isolation, public/private owner
display, owner-only edit and delete routes, immutable fields and audio bytes,
invalid and forged updates, explicit POST deletion, missing-file deletion,
Post/Redirect/Get refresh behavior, response privacy, and public search,
stream, and download regressions. Startup is bounded to 60 seconds, the whole
run to 120 seconds, and each request to 10 seconds. Cleanup closes the database
client and HTTP agent, terminates exactly the Vite child it started, closes
both output streams, verifies its listener and process are gone, and removes
its temporary directory. The controller also compares the real database and
audio storage before and after the run and verifies the complete copied
`Party about you` record is unchanged.

For a manual two-user authorization check, upload tracks with two disposable
accounts. While signed in as the first account, confirm `/my-tracks` excludes
the second account's tracks and that direct edit and delete URLs for those
tracks return the same safe 404 as a nonexistent track. Confirm a forged POST
cannot update or delete the second account's row or file. See
`MANUAL_TESTS.md` for the complete Phase 6 checklist.

The complete browser checklist for playback, seeking, download names,
authentication, upload validation, and responsive navigation is in
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

## Phase 6 boundary

Phase 6 includes authenticated My Tracks, public and private owner listings,
owner-only metadata editing, explicit POST deletion, safe file quarantine and
rollback, and owner actions on public detail pages. It intentionally does not
include audio-file replacement, visibility controls, pagination, playlists,
comments, ratings, recommendations, automatic BPM or key detection,
transcoding, waveform generation, or administrator functionality.

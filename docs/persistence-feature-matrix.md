# Persistence feature matrix

This matrix is the M8 regression inventory for the two still-supported
persistence backends. MongoDB is the active local-development backend. SQLite
and Drizzle remain intact as the rollback path.

| Domain | SQLite implementation and coverage | MongoDB implementation and coverage | Parity result |
| --- | --- | --- | --- |
| Backend selection | `users/backend`, SQLite repositories; backend unit tests and rollback integration | The same unified selector chooses MongoDB users, sessions, and tracks; mixed selection is rejected | One backend is selected for all persistence domains |
| Users | SQLite user repository unit/registration tests | M2 user contract integration: normalization, conflict lookup, safe projections, password verification, duplicate-key mapping | App-level user, auth, and account projections match |
| Sessions | SQLite session repository and auth/session tests | M3 auth integration: creation, token hashing, lookup, expiry, missing user, logout, uniqueness, transaction rollback | Raw tokens are never stored; invalid/expired sessions are rejected |
| Registration | One SQLite transaction | One required replica-set/sharded MongoDB transaction | User and initial session commit or roll back together |
| Tracks | SQLite track repository and service tests | M4 track integration: creation, atomic public IDs, safe public/owner/storage projections, owner CRUD | Public numeric IDs, metadata, ownership, visibility, and nullability match |
| Public browsing | Phase 5 SQLite HTTP integration | M5 direct SQLite/MongoDB normalized-result comparison | Search, inclusive BPM bounds, musical key, genre, combined filters, no-result behavior, and all six sorts match |
| Upload/file consistency | Phase 4 and service/files tests | M4 insertion-failure cleanup plus M7 full-app upload | Failed metadata insertion removes only the newly written file |
| Media | Phase 4/6 full, Range, invalid Range, download, and missing-file tests | M7 full-app full stream, Range, and download plus shared media tests | Status, bytes, headers, and safe 404/416 behavior are backend-independent |
| Owner management | Phase 6 isolated HTTP integration | M4 repository plus M7 full-app edit/delete integration | Owner-only updates/deletes preserve immutable fields and reject non-owners safely |
| Delete quarantine | Shared management/files tests and Phase 6 HTTP integration | M4 success, database-failure restore, missing-file deletion, and exact audio cleanup | Metadata and filesystem remain consistent on success and failure |
| Migration | SQLite snapshot reader | M6 dry-run/apply/verify integration | UUIDs, hashes, ownership, public IDs, visibility, nulls, timestamps, and storage references are preserved; sessions/audio are excluded |

## Browser privacy

Public responses contain only public numeric IDs, display metadata, safe owner
usernames, MIME/file-size metadata, and timestamps required by the UI. Owner
responses add only owner-safe metadata. They do not expose internal UUIDs,
session IDs or hashes, password hashes, storage keys, absolute paths, database
names, MongoDB URIs, or credentials. The public and owner model tests, Phase 5
`__data.json` checks, Phase 6 privacy scan, and M7 full-app routes enforce this
boundary.

## Failure-path inventory

The M8 regression command covers missing/invalid configuration, unsupported or
mixed backend selection, duplicate username/email/storage/public-ID mappings,
failed initial-session insertion rollback, expired and missing-user sessions,
track insertion cleanup, filesystem validation/read/write failures, invalid
Range behavior, quarantine failure and restore, transaction rollback, unsafe
migration targets, and verification mismatch detection. MongoDB transaction
tests require a replica set, sharded deployment, or Atlas and never use a
non-atomic fallback.

## Cutover requirement map

The aggregate command intentionally uses the smallest authoritative layer for
each behavior and keeps the M7 full-app flow as the end-to-end spine.

| M8 checks | Behavior | Enforcing suite |
| --- | --- | --- |
| 1–2 | MongoDB application startup and required indexes | M7 full-app cutover; M2–M6 index assertions; `db:mongodb:check` |
| 3–7 | registration, duplicate username/email, login, invalid login | M7 full-app cutover; M2 users; M3 auth; auth validation tests |
| 8–12 | session persistence, invalid/expired sessions, logout, protected route | M3 auth/session tests; M7 logout; Phase 6 signed-out redirect |
| 13–15 | upload validation, successful upload, failed-insert file cleanup | Phase 4/service tests; M4 tracks; M7 full-app upload |
| 16–20 | Browse, public/private visibility, search and combined filters | M5 normalized SQLite/MongoDB parity; M7 Browse |
| 21 | newest, oldest, title asc/desc, BPM asc/desc | M5 parity checks 21–26 |
| 22–23 | public detail and public-safe global/player payloads | M7 detail; public model tests; Phase 5/6 privacy scans |
| 24–27 | full stream, Range, invalid Range, download | M7 media flow; shared range/media tests |
| 28–32 | My Tracks and owner/non-owner edit/delete | M4 owner contract; M7 full-app owner flow; Phase 6 |
| 33–35 | quarantine success/rollback and missing audio | M4 checks 19–21; management/files tests; Phase 6 |
| 36–37 | safe missing-track 404 and private direct rejection | M4 safe-null/private lookups; public route/media tests |
| 38–41 | user, session, track, and audio cleanup | Each isolated controller plus M7 exact cleanup |
| 42–47 | exact DB, process, port, MongoClient, ClientSession, listener/timer cleanup | Controller `finally` blocks, M7 postconditions, and M8 supervisor |

## Test database ownership

Each MongoDB controller derives a unique name from `MONGODB_TEST_DB_NAME`,
validates the test prefix and separation from the development database, records
only the exact database it owns, and drops only that database during `finally`
cleanup. The M8 supervisor snapshots the full pre-existing test-database name
set before the suites and requires exact equality afterward. Primary failures
and cleanup failures are reported separately; cleanup still runs after a
primary failure.

## M8 commands

```powershell
npm run test:mongodb:regression
npm run test:sqlite:rollback
npm run verify:mongodb:clean-clone
```

The MongoDB regression aggregates the M2–M7 controllers and focused
configuration/privacy/filesystem tests. The SQLite rollback command migrates a
fresh temporary SQLite database, runs the isolated 31-check application suite,
and verifies that the real MongoDB, SQLite database, audio tree, and `.env`
remain byte-for-byte or aggregate-identical. The clean-clone command uses a
fresh release-candidate copy, a newly owned test database, fresh temporary
SQLite/audio paths, and exact cleanup.

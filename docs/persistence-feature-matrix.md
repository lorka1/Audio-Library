# MongoDB persistence feature matrix

MongoDB is the only active persistence backend. All application routes reach
it through centralized server-only persistence modules.

| Domain | Active implementation | Automated coverage |
| --- | --- | --- |
| Configuration and startup | Validated private environment, application/test database separation, one cached client, explicit index initialization, read-only operational verification | MongoDB config/client/index/verification tests; clean-copy production probe |
| Users | MongoDB user repository with normalized conflict lookup and safe projections | User contract integration; duplicate username/email mapping; password verification |
| Sessions | Hashed-token MongoDB session repository | Auth integration and session unit tests: creation, lookup, expiration, missing user, logout, uniqueness |
| Registration | Required MongoDB transaction for user plus initial session | Commit, duplicate-conflict rollback, failed-session rollback, and transaction-support checks |
| Tracks | MongoDB track repository, atomic public-ID counter, and optional cover metadata | Creation, concurrent allocation, legacy tracks without covers, safe public/owner/storage projections, owner CRUD, missing tracks |
| Private playlists (P1) | Normalized `playlists` and `playlistItems` collections with owner-scoped safe projections and opaque public IDs | Create/list/detail/update/delete; public and owned-private add; idempotent duplicate add; remove; non-owner/missing/inaccessible rejection; track-deletion cleanup |
| Playlist images | Optional safe MongoDB metadata plus separate private JPEG/PNG/WebP storage and owner-only delivery | Validation, fallback art, authorization, replacement/removal/deletion rollback, and recovery fingerprints |
| Playlist transactions | Add/remove update `updatedAt`; delete cascades items; track deletion removes all memberships | Commit/rollback boundaries, exact membership uniqueness, session cleanup, unrelated-item preservation |
| Public browsing | MongoDB aggregation with public visibility enforcement | Literal title/artist/description search, BPM bounds, key, genre, combined filters, no-result behavior |
| Sorting | MongoDB deterministic aggregation sorts | Newest, oldest, title ascending/descending, BPM ascending/descending, null BPM last, tie ordering |
| Upload | MongoDB metadata plus private filesystem audio and optional JPEG, PNG, or WebP cover | Audio/cover validation, upload without a cover, successful covered upload, failure cleanup, never-reused public IDs |
| Media | Public MongoDB lookup plus contained filesystem reads | Full stream, byte Range seeking, invalid/unsatisfiable Range, download, safe cover endpoint, private/missing rejection |
| Owner management | Owner-scoped MongoDB lookups and mutations | My Tracks, metadata and cover edit, retain/replace/remove, non-owner rejection, immutable fields, delete confirmation and execution |
| Delete recovery | Quarantine audio and optional cover, transactionally delete MongoDB track plus playlist memberships, remove or restore files | Success, database failure restore, quarantine failures, missing cover/audio, concurrent deletion, playlist cleanup |
| Privacy | Public, owner, account, navigation, and server-only models | Projection unit tests, safe cover URL/state, storage-key exclusion, full-app payload checks, sanitized error-path tests |
| Resource safety | Unique owned database, temporary audio/cover storage and port, bounded clients/processes | Every integration controller plus aggregate supervisor and clean-copy postconditions |
| Operations | Bounded startup/readiness, liveness, structured safe logs, SIGINT/SIGTERM shutdown | Operational failure-path tests and production startup/shutdown probe |
| Recovery | Native MongoDB dump (including playlist image metadata), aggregate-verified audio/cover/playlist-image copy, owned isolated restore | Missing-tool/path/mismatch tests and complete synthetic track/playlist/image recovery integration |

## Full-application traceability

The cutover and aggregate regression commands cover:

- explicit database initialization plus read-only startup and readiness;
- registration, duplicate conflicts, login, invalid credentials, sessions,
  expiration, logout, and protected routes;
- audio and optional cover validation, covered/uncovered upload, and
  failed-write/failed-insert cleanup;
- Browse, public/private visibility, query combinations, all six sorts, detail,
  player-safe models, fallback artwork, cover delivery, full and Range
  streaming, invalid Range, and download;
- My Tracks, owner/non-owner cover retain/replace/remove and delete, quarantine
  success/restore, missing-file and safe 404 behavior;
- private playlist ownership, membership, inaccessible-track omission, and
  track-deletion cleanup;
- exact user/session/track/playlist/item/audio/cover/database/process/port/client/session/
  listener cleanup.

## Privacy boundary

Public and owner responses contain only fields required by their UI, including
a safe cover URL or state. Internal identifiers, password material, session
material, audio and cover storage references, paths, database configuration,
and audit fingerprints remain server-only.

Playlist summaries expose only opaque public IDs, names, optional descriptions,
counts, and timestamps. Detail entries expose a safe track view plus `addedAt`;
internal playlist/item/track UUIDs and owner/storage fields never enter page data.

## Historical note

Before the completed migration, the project used a SQLite/Drizzle backend.
Cross-backend parity and rollback validation were completed before that code
was removed. The historical backup remains outside Git and is not an active
runtime or test dependency.

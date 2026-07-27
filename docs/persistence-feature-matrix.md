# MongoDB persistence feature matrix

MongoDB is the only active persistence backend. All application routes reach
it through centralized server-only persistence modules.

| Domain | Active implementation | Automated coverage |
| --- | --- | --- |
| Configuration and startup | Validated private environment, application/test database separation, one cached client, explicit index initialization, read-only operational verification | MongoDB config/client/index/verification tests; clean-copy production probe |
| Users | MongoDB user repository with normalized conflict lookup and safe projections | User contract integration; duplicate username/email mapping; password verification |
| Sessions | Hashed-token MongoDB session repository | Auth integration and session unit tests: creation, lookup, expiration, missing user, logout, uniqueness |
| Registration | Required MongoDB transaction for user plus initial session | Commit, duplicate-conflict rollback, failed-session rollback, and transaction-support checks |
| Tracks | MongoDB track repository and atomic public-ID counter | Creation, concurrent allocation, safe public/owner/storage projections, owner CRUD, missing tracks |
| Public browsing | MongoDB aggregation with public visibility enforcement | Literal title/artist/description search, BPM bounds, key, genre, combined filters, no-result behavior |
| Sorting | MongoDB deterministic aggregation sorts | Newest, oldest, title ascending/descending, BPM ascending/descending, null BPM last, tie ordering |
| Upload | MongoDB metadata plus private filesystem audio | Validation, successful full-app upload, insertion-failure file cleanup, never-reused public IDs |
| Media | Public MongoDB lookup plus contained filesystem reads | Full stream, byte Range seeking, invalid/unsatisfiable Range, download, private/missing rejection |
| Owner management | Owner-scoped MongoDB lookups and mutations | My Tracks, edit, non-owner rejection, immutable fields, delete confirmation and execution |
| Delete recovery | Quarantine file, delete MongoDB record, remove or restore file | Success, database failure restore, quarantine failures, missing file, concurrent deletion |
| Privacy | Public, owner, account, navigation, and server-only models | Projection unit tests, full-app payload checks, sanitized error-path tests |
| Resource safety | Unique owned database, temporary audio/port, bounded clients/processes | Every integration controller plus aggregate supervisor and clean-copy postconditions |
| Operations | Bounded startup/readiness, liveness, structured safe logs, SIGINT/SIGTERM shutdown | Operational failure-path tests and production startup/shutdown probe |
| Recovery | Native MongoDB dump, separate aggregate-verified audio copy, owned isolated restore | Missing-tool/path/mismatch tests and complete synthetic recovery integration |

## Full-application traceability

The cutover and aggregate regression commands cover:

- explicit database initialization plus read-only startup and readiness;
- registration, duplicate conflicts, login, invalid credentials, sessions,
  expiration, logout, and protected routes;
- upload validation, successful upload, and failed-insert cleanup;
- Browse, public/private visibility, query combinations, all six sorts, detail,
  player-safe models, full and Range streaming, invalid Range, and download;
- My Tracks, owner/non-owner edit and delete, quarantine success/restore,
  missing-file and safe 404 behavior;
- exact user/session/track/audio/database/process/port/client/session/listener
  cleanup.

## Privacy boundary

Public and owner responses contain only fields required by their UI. Internal
identifiers, password material, session material, storage references, paths,
database configuration, and audit fingerprints remain server-only.

## Historical note

Before the completed migration, the project used a SQLite/Drizzle backend.
Cross-backend parity and rollback validation were completed before that code
was removed. The historical backup remains outside Git and is not an active
runtime or test dependency.

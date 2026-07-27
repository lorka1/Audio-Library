# MongoDB migration release candidate

## Recommended release identity

The committed project version is `0.1.0`, and the repository has no existing
Git tags. The MongoDB-only persistence cutover is a substantial, operationally
breaking change while the project remains pre-1.0. The recommended semantic
version is therefore `0.2.0`.

- Final M11 commit: `chore: finalize MongoDB migration release candidate`
- Merge commit: `merge: complete MongoDB migration and production hardening`
- Annotated tag: `v0.2.0`
- Release title: `Audio Library v0.2.0 — MongoDB-only persistence`

These are release instructions only. M11 does not create the commit, merge,
tag, or release.

## Release notes

Audio Library now uses MongoDB exclusively for users, sessions, authentication,
track metadata, queries, ownership, and atomic numeric public track IDs. Users
and track metadata were migrated while preserving identifiers and storage
references. Sessions were intentionally not migrated during cutover, so
existing users needed to sign in again. Audio bytes remain in private
filesystem storage.

The release preserves Browse/detail/media/owner behavior and complete
search/filter/sort coverage, including literal metacharacters, inclusive BPM
bounds, nullable BPM, deterministic sorting, full and Range streaming, and
downloads. Registration is transactional, session tokens remain hashed, and
track deletion retains quarantine/rollback safety.

Production operations now include strict startup validation, liveness and
readiness endpoints, structured safe logging, bounded graceful shutdown, native
MongoDB backup tooling, separate aggregate-verified audio backup, and isolated
restore verification. The supported self-hosted topology runs the application
and a transaction-capable single-node MongoDB replica set on the same Windows
computer.

## Upgrade and deployment notes

1. Retain the verified historical migration backup separately.
2. Install from the lockfile and configure the active variables documented in
   `.env.example`.
3. Ensure MongoDB is a writable replica-set PRIMARY and is not publicly
   exposed.
4. For a new target database, run `npm run db:mongodb:init`; then always run
   `npm run db:mongodb:verify`.
5. Preserve the private audio directory and its permissions.
6. Build with `npm run build` and start with `npm start` behind HTTPS.
7. Commission local liveness/readiness monitoring.
8. Schedule MongoDB and audio backups as paired recovery sets and periodically
   run isolated restore verification.

## Operational requirements and limitations

- A standalone MongoDB server is unsupported because transactions are required.
- TCP 27017 must remain bound to localhost or an explicitly trusted private
  interface and must not be exposed publicly.
- Audio is not stored in MongoDB or GridFS and requires a separate backup.
- MongoDB Database Tools are required for native backup and restore checks.
- Backup retention is intentionally not automatic.
- No current real production recovery set is implied by the synthetic tooling
  tests; creating one requires separate operator authorization.
- Historical SQLite artifacts are migration evidence only and cannot run the
  current application.

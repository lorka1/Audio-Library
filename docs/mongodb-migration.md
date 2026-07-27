# MongoDB migration status

## M8 cutover regression

M8 completes the cutover regression without removing the SQLite rollback
implementation. The aggregate MongoDB suite covers user/session/track
contracts, transactional auth, duplicate and rollback failures, public query
parity, all deterministic sorts, privacy projections, upload cleanup, media,
owner edit/delete, quarantine recovery, migration rollback, the full
application cutover, and exact resource cleanup.

The isolated SQLite rollback suite builds a fresh temporary database from the
committed SQL migrations and runs the 31-check owner/public application
regression with `DATABASE_BACKEND=sqlite`. It does not copy or modify the real
SQLite database. Before and after the suite, the controller compares the real
MongoDB fingerprint/counter, SQLite database/WAL/SHM, audio tree, and `.env`.

The clean-clone controller creates a fresh release-candidate source copy,
installs from the lockfile, runs checks, tests, the MongoDB regression, build,
and production HTTP probes against a newly owned test database, then removes
the exact database and temporary source. See
[`persistence-feature-matrix.md`](persistence-feature-matrix.md) for the
traceable backend and failure-path inventory.

## M7 local development cutover

M7 migrated the existing local development users and track metadata from
SQLite to MongoDB in one replica-set transaction. The migration preserved:

- user and track UUIDs;
- usernames, emails, and existing password hashes;
- track public IDs and ownership;
- public/private visibility and nullable metadata;
- timestamps, original filenames, and private storage references.

Active sessions and session-token hashes were not migrated. Existing browser
sessions are therefore invalid and users must sign in again. Audio bytes were
not copied: the application continues to use the private filesystem directory
configured by `AUDIO_STORAGE_PATH`.

Post-migration verification matched the SQLite source fingerprints and counts,
confirmed a completed migration marker, verified the public-ID counter, and
confirmed that required indexes remained present. A verified timestamped
SQLite backup and sanitized pre-/post-migration reports exist outside the
repository.

The local untracked `.env` selects `DATABASE_BACKEND=mongodb`. SQLite, Drizzle,
and `DATABASE_URL` remain temporarily available for rollback. No SQLite
dependency, migration, source database, or original audio file was removed.

## Rollback

1. Stop the application.
2. Set `DATABASE_BACKEND=sqlite` in the local untracked `.env`.
3. Start the application.
4. Verify that startup selects SQLite persistence.
5. Preserve the migrated MongoDB data and M7 reports for diagnosis.

Rollback must not automatically delete the migrated MongoDB database. Preserve
the original SQLite database, verified external backup, and private audio
storage.

## Verification commands

```powershell
npm run test:mongodb:auth
npm run test:mongodb:tracks
npm run test:mongodb:queries
npm run test:mongodb:migration
npm run test:mongodb:cutover
npm run test:mongodb:regression
npm run test:sqlite:rollback
npm run verify:mongodb:clean-clone
npm run audit:mongodb:cutover
npm run db:migrate:mongodb:verify
```

M8 is complete. SQLite removal has not started and is explicitly outside this
phase.

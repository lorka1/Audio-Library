# MongoDB migration status

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
npm run db:migrate:mongodb:verify
```

M8 remains responsible for the complete cutover regression. SQLite removal has
not started.

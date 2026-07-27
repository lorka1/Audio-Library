# MongoDB migration history

## Completed cutover

The historical SQLite source was migrated to MongoDB in one transaction. The
cutover preserved:

- user and track internal identifiers;
- usernames, emails, and password hashes;
- track ownership and public numeric IDs;
- public/private visibility and nullable metadata;
- timestamps, original filenames, and private storage references.

Sessions and session-token hashes were intentionally excluded, so existing
users had to sign in again. Audio bytes were not copied into MongoDB; the
application continues to use private filesystem storage.

The migration was verified with source/target fingerprints, record counts,
required indexes, the public-ID counter, and a completion marker. The complete
MongoDB application regression and clean-copy verification passed before the
old runtime was removed.

## MongoDB-only repository

SQLite runtime code, Drizzle configuration, old migrations, dual-backend
selection, executable migration/apply tools, rollback controllers, and their
package dependencies were removed in M9. MongoDB is now the only application
persistence backend.

No migration command remains that can accidentally reapply the historical
cutover. The completion marker is retained in MongoDB as historical evidence
and is checked read-only by the safety audit.

## External historical artifacts

A verified SQLite backup and sanitized migration/rollback package remain
outside Git. They are historical artifacts only and are not read by the active
application, tests, build, or clean-copy verification. Their machine-specific
location, hashes, and private reports are intentionally not documented in the
repository.

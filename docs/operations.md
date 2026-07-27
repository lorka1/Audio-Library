# MongoDB production operations

## Same-computer Windows topology

Run MongoDB and the Node/SvelteKit application on the same Windows computer.
Configure MongoDB as a single-node replica set and enable access control for a
production installation. Bind MongoDB to localhost, or to an explicitly trusted
private interface when administration requires it. The application should
connect through localhost.

Never expose, forward, or create a public firewall rule for TCP 27017. The web
application or its reverse proxy is the only public-facing service. Permit the
application port only from the reverse proxy when they are separate processes.

MongoDB can run as its Windows service. Start it before the application and set
both services to restart after unexpected failure. The Node application can be
managed with Windows Service Control through a suitable service wrapper, Task
Scheduler, or another process manager that preserves environment variables and
performs a controlled stop. No particular third-party manager is required.

## Private configuration and directories

Copy `.env.example` to an untracked private environment source. Configure the
MongoDB URI and database names, private audio path, upload/body limits, cookie
name and duration, and the production host, port, and HTTPS origin. Backup
commands additionally require explicit MongoDB and audio backup roots.

Do not print or commit the URI or credentials. Give the application identity
read/write permission only to its private audio directory and application
database. Place audio outside `static`, `public`, `build`, and any reverse-proxy
document root. Backup roots should be protected and preferably on a separate
disk. Logs belong in an operator-selected protected location.

Secure session cookies require HTTPS. Terminate HTTPS at a trusted reverse proxy,
forward the original scheme and host correctly, and keep `ORIGIN` equal to the
external HTTPS origin.

## Initial deployment and startup

1. Install dependencies with `npm ci`.
2. Start the local MongoDB Windows service and confirm the replica set has a
   writable PRIMARY.
3. For a new database only, run `npm run db:mongodb:init`.
4. Run `npm run db:mongodb:verify`.
5. Build with `npm run build`.
6. Start with `npm start`.
7. Probe `/api/health/live` and `/api/health/ready`.

Startup fails before listening when configuration, storage, MongoDB topology,
indexes, or counter state is unsafe. Startup does not reconnect forever.
Readiness is bounded and read-only. Liveness does not depend on MongoDB. SIGINT
and SIGTERM stop accepting requests, wait a bounded interval, and close
application-owned listeners and the shared MongoDB client exactly once.

## Verification and recovery sets

`npm run db:mongodb:verify` is read-only. It checks connectivity, transaction
topology, writable PRIMARY state, required collections, exact required index
names/keys/options, the track counter, and a historical marker when present. It
never initializes or repairs indexes.

Create paired backups:

```powershell
npm run backup:mongodb
npm run backup:audio
```

The first wraps `mongodump`; the second copies private audio and verifies file
count, aggregate size, and aggregate content hash. Each creates a new
timestamped destination, uses an `INCOMPLETE` marker until successful, and
writes a sanitized manifest. Neither overwrites output or deletes old backups.
The audio copy includes every stored file, including an unreferenced one.

Treat both outputs as one logical recovery set. Record the pairing in private
operational inventory, apply a separately approved retention policy, and never
commit backup output.

Periodically verify a wholly synthetic recovery set:

```powershell
npm run test:mongodb:recovery
```

It creates an owned test source and restore database plus temporary private
audio, then checks indexes, safe aggregates, counter compatibility, referenced
audio, and read-only Browse/detail/stream repository paths. Cleanup removes only
its exact owned databases and temporary directories.

For an operator-supplied synthetic pair, set `MONGODB_RESTORE_SOURCE` and
`AUDIO_RESTORE_SOURCE` to the two completed directories and run
`npm run verify:mongodb:restore`. It never targets the configured application
database, a pre-existing test database, or real audio storage. A real disaster
restore requires separate approval, a maintenance window, verified targets, and
a current paired recovery set.

## Firewall, monitoring, and logs

Expose HTTPS through the reverse proxy and keep MongoDB private. Monitor
liveness independently from readiness to avoid uncontrolled restart loops.
Operational logs contain only timestamp, severity, safe category/code, request
ID, method, route category, status, and duration. Never add request bodies,
cookies, authorization headers, identities, filenames, storage keys, absolute
paths, MongoDB documents, URIs, credentials, or migration fingerprints.

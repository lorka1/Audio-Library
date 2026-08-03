# Production commissioning checklist

Use this checklist for deployment of MongoDB and Audio Library on the same
Windows computer. Do not record credentials, private addresses, filesystem
paths, filenames, or database contents in the completed checklist.

## MongoDB

- [ ] The MongoDB Windows service is installed, running, and configured to
  restart according to the operator's policy.
- [ ] The single-node replica set is initialized and the member is PRIMARY.
- [ ] A read-only transaction capability check succeeds.
- [ ] `MONGODB_URI` connects locally and includes the intended
  `replicaSet=rs0` option.
- [ ] MongoDB binds only to localhost or an explicitly trusted private
  interface.
- [ ] Windows Firewall does not expose or forward TCP 27017 publicly.
- [ ] The application identity has only the required database permissions.
- [ ] `npm run db:mongodb:init` was run only when commissioning a new database.
- [ ] `npm run db:mongodb:verify` passes without writes.

## Application

- [ ] The production `.env` or service environment exists and is not committed.
- [ ] The public `ORIGIN` uses HTTPS and secure cookies are expected.
- [ ] `HOST` and `PORT` expose only the intended web listener.
- [ ] The reverse proxy forwards the intended origin and terminates HTTPS where
  applicable.
- [ ] The private audio root and its `covers/` subdirectory exist with the
  required read/write permissions.
- [ ] The complete media root is outside `static`, `public`, `build`, and every
  reverse-proxy document root.
- [ ] `MAX_AUDIO_FILE_SIZE_MB` and `COVER_IMAGE_MAX_SIZE_MB` are positive, and
  `BODY_SIZE_LIMIT` is at least their combined value plus 1 MiB of
  multipart/form-data overhead.
- [ ] JPEG, PNG, and WebP covers are available only through
  `/api/tracks/[id]/cover`; private tracks and private storage details are not
  exposed.
- [ ] Tracks without a cover display the local fallback artwork.
- [ ] The separate `PLAYLIST_IMAGE_STORAGE_PATH` is private and writable;
  playlist images are owner-only and image-less playlists show local fallback art.
- [ ] Authenticated navigation exposes Playlists on desktop and mobile; signed-out
  navigation does not expose the private destination.
- [ ] Private playlist create, rename, description edit, delete, add, and remove
  work only for the owner; guessed non-owned IDs return the same safe 404.
- [ ] Public and owned-private tracks can be added; another user's private track
  and later-inaccessible track data are never exposed.
- [ ] `npm ci`, `npm run check`, `npm test`, and `npm run build` pass.
- [ ] Production starts with `npm start`.
- [ ] `/api/health/live` is reachable by the local service monitor.
- [ ] `/api/health/ready` returns ready after MongoDB and storage are available.
- [ ] SIGINT/SIGTERM restart behavior and the bounded forced-shutdown policy are
  understood.
- [ ] Operational logs are stored privately and preserve the documented safe
  field boundary.

## Recovery

- [ ] MongoDB Database Tools are installed and their version is recorded in
  private operational inventory.
- [ ] MongoDB and private-media backup roots are private, explicit, and outside
  Git and public content.
- [ ] MongoDB and private-media backups are scheduled as one logical recovery
  set, and the filesystem backup includes audio, `covers/`, and playlist images.
- [ ] No automatic destructive retention is assumed; an approved retention
  policy exists separately.
- [ ] Periodic isolated restore verification covers MongoDB track/playlist metadata plus
  referenced audio, cover, and playlist-image files.
- [ ] A completed synthetic `npm run test:mongodb:recovery` run is recorded.
- [ ] The historical SQLite backup remains separately retained as migration
  history only.
- [ ] Operators understand that the current application cannot run on SQLite.

No specific commercial process manager is required. Windows Service Control,
Task Scheduler, or another suitable service wrapper may be used if it preserves
the private environment and controlled shutdown behavior.

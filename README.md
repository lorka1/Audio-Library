# Audio Library

Audio Library is a full-stack SvelteKit application for uploading, organizing, and listening to audio tracks. Users can create an account, manage their own tracks, browse the public library, search and filter tracks, and create private playlists.

MongoDB stores application data, while audio files and images are kept in private filesystem storage and served through application routes.

## Requirements

- Node.js `^22.12.0` or `>=24`
- npm `>=10`
- MongoDB configured as a replica set

Replica-set support is required because the application uses MongoDB transactions. A local single-node replica set is enough for development.

## Setup

Install the dependencies and create your local environment file:

```powershell
npm ci
Copy-Item .env.example .env
```

Review the values in `.env`, especially the MongoDB connection and storage paths. The default example expects a local replica set named `rs0`.

Initialize a new application database:

```powershell
npm run db:mongodb:init
```

Start the development server:

```powershell
npm run dev
```

## Features

- account registration, login, logout, and cookie-based sessions
- public and private audio tracks
- MP3, WAV, and OGG uploads
- optional track covers and playlist artwork
- track browsing, search, filters, and sorting
- browser playback with seeking and volume controls
- audio downloads using the original filename
- owner-only track editing and deletion
- private playlists with add and remove controls
- responsive light and dark interface

## Technology

- SvelteKit and Svelte 5
- TypeScript
- MongoDB
- Vite
- Node adapter for production
- bcryptjs for password hashing

## Environment variables

The available settings are documented in `.env.example`.

| Variable | Description |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string, including the replica-set option |
| `MONGODB_DB_NAME` | Database used by the application |
| `AUDIO_STORAGE_PATH` | Private storage directory for audio files and track covers |
| `MAX_AUDIO_FILE_SIZE_MB` | Maximum audio upload size |
| `COVER_IMAGE_MAX_SIZE_MB` | Maximum track-cover upload size |
| `PLAYLIST_IMAGE_STORAGE_PATH` | Private storage directory for playlist artwork |
| `PLAYLIST_IMAGE_MAX_SIZE_MB` | Maximum playlist-image upload size |
| `BODY_SIZE_LIMIT` | Maximum request size accepted by the Node server |
| `SESSION_COOKIE_NAME` | Name of the session cookie |
| `SESSION_DURATION_DAYS` | Session lifetime in days |

Do not commit `.env` or add credentials to tracked files.

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run check` | Run Svelte and TypeScript checks |
| `npm run build` | Create the production build |
| `npm start` | Start the production Node server |
| `npm run preview` | Preview the production build with Vite |
| `npm run db:mongodb:init` | Initialize MongoDB indexes and counters |

## File storage

Audio and image files are stored outside `static/` so they cannot be accessed directly. MongoDB contains their metadata, and the application provides routes for playback, downloads, and images.

Supported audio formats are MP3, WAV, and OGG. Track covers and playlist images support JPEG, PNG, and WebP.

## Production

Build the application, set the public origin and listener values, then start the Node server:

```powershell
npm run build
$env:HOST='127.0.0.1'
$env:PORT='3000'
$env:ORIGIN='https://your-host.example'
npm start
```

`GET /api/health/live` checks whether the application is running. `GET /api/health/ready` also checks MongoDB and media storage.

See [docs/operations.md](docs/operations.md) for a more detailed Windows setup and production guide.

## Project structure

```text
src/lib/components/   reusable Svelte components
src/lib/server/       authentication, MongoDB, tracks, playlists, and storage
src/routes/           pages, form actions, and API routes
scripts/              MongoDB initialization and production startup
storage/              private local media files
```

Playlists are currently private to their owner. Sharing, collaboration, manual reordering, and recommendations are outside the current project scope.

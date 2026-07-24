# Manual application tests

Run the application with:

```powershell
npm run db:migrate
npm run dev
```

Use unique synthetic account details and disposable test audio that are not
used for any real service.

## Registration

- [ ] Open `/register` while signed out. The registration form is displayed.
- [ ] Submit all fields empty. Required-field feedback is shown and no account is created.
- [ ] Submit a username shorter than three characters. A username length error is shown.
- [ ] Submit a username containing a hyphen or space. An allowed-characters error is shown.
- [ ] Submit an invalid email. An email validation error is shown.
- [ ] Submit a password shorter than eight characters. A password length error is shown.
- [ ] Submit different password and confirmation values. A mismatch error is shown.
- [ ] Register with valid unique details. You are redirected home and shown as signed in.
- [ ] Log out, then try registering with the same email. A clear occupied-email error is shown.
- [ ] Try registering with the same username and a different email. A clear occupied-username error is shown.

## Login and session persistence

- [ ] Open `/login` while signed out. The login form is displayed.
- [ ] Submit an unknown email and a password. The message is exactly `Email or password is incorrect.`
- [ ] Submit an existing email with a wrong password. The same generic message is shown.
- [ ] Log in with correct credentials. You are redirected home and your username appears in navigation.
- [ ] Refresh the page. You remain signed in.
- [ ] Close and reopen the browser before the seven-day expiry. The session remains active.
- [ ] Inspect the cookie in browser developer tools. It is HttpOnly, SameSite=Lax, scoped to `/`, and has an expiry.
- [ ] In a production HTTPS deployment, confirm the session cookie also has the Secure flag.
- [ ] Inspect the `sessions` table. It contains a token hash, never the raw cookie token.

## Protected and guest-only routes

- [ ] While signed out, open `/account`. You are redirected to `/login`.
- [ ] Log in after that redirect. You return to `/account`.
- [ ] While signed in, open `/account`. Username and email are displayed; no password hash or session token appears.
- [ ] While signed in, open `/login`. You are redirected home.
- [ ] While signed in, open `/register`. You are redirected home.

## Logout and invalid sessions

- [ ] Use the navigation Logout button. The request uses POST and you are redirected home.
- [ ] Refresh after logout. You remain signed out.
- [ ] After logout, open `/account`. You are redirected to `/login`.
- [ ] Replace the session cookie with a malformed value and refresh. The application remains available and clears the cookie.
- [ ] Remove the current session row from the local database, then refresh. The application signs you out without exposing an internal error.
- [ ] Set a session expiry in the past, then refresh. The session is removed and the browser cookie is cleared.

## Audio upload

### UPL-001 — Protected route while signed out

- [ ] Sign out and open `/upload`.
- [ ] Expected: You are redirected to `/login`, with `/upload` retained as the safe return destination.

### UPL-002 — Upload form while signed in

- [ ] Sign in and open `/upload`.
- [ ] Expected: The multipart upload form is available with audio file, title, artist, BPM, musical key, genre, and description fields.

### UPL-003 — Valid MP3 upload

- [ ] Upload a non-empty `.mp3` file reported as `audio/mpeg` with valid metadata.
- [ ] Expected: You are redirected to the new public track detail page, the success message appears, a generated `.mp3` file exists under the configured private storage directory, and one matching `tracks` row exists.

### UPL-004 — Valid WAV upload

- [ ] Upload a non-empty `.wav` file using one supported WAV MIME type: `audio/wav`, `audio/x-wav`, `audio/wave`, or `audio/vnd.wave`.
- [ ] Expected: The upload succeeds and matching file and metadata records exist.

### UPL-005 — Valid OGG upload

- [ ] Upload a non-empty `.ogg` file reported as `audio/ogg`.
- [ ] Expected: The upload succeeds and matching file and metadata records exist.

### UPL-006 — Unsupported file

- [ ] Attempt to upload a TXT or PDF file.
- [ ] Expected: The server rejects it as an unsupported audio format, and no file or track row is created.

### UPL-007 — Extension and MIME mismatch

- [ ] Rename a non-MP3 test file to `.mp3` while retaining a non-`audio/mpeg` MIME type and submit it.
- [ ] Expected: The server rejects the mismatched extension/MIME pair, and nothing is stored.

### UPL-008 — Empty file

- [ ] Submit a zero-byte file with an otherwise supported filename and MIME type.
- [ ] Expected: The server reports that the audio file must not be empty, and nothing is stored.

### UPL-009 — File over the limit

- [ ] Submit an audio file larger than `MAX_AUDIO_FILE_SIZE_MB`.
- [ ] Expected: The upload is rejected with a clear size error, and no file or track row is created.

### UPL-010 — Missing title

- [ ] Submit an otherwise valid upload with a blank or whitespace-only title.
- [ ] Expected: A title-required error appears, the other text values remain populated, the file must be selected again, and nothing is stored.

### UPL-011 — BPM below the range

- [ ] Submit BPM `19`.
- [ ] Expected: The server reports that BPM must be between 20 and 300.

### UPL-012 — BPM above the range

- [ ] Submit BPM `301`.
- [ ] Expected: The server reports that BPM must be between 20 and 300.

### UPL-013 — Decimal BPM

- [ ] Submit BPM `120.5`, bypassing browser validation if necessary.
- [ ] Expected: The server reports that BPM must be an integer.

### UPL-014 — Forged musical key

- [ ] Manually submit a musical-key value that is not in the displayed list.
- [ ] Expected: The server rejects it with a musical-key validation error.

### UPL-015 — Forged genre

- [ ] Manually submit a genre value that is not in the displayed list.
- [ ] Expected: The server rejects it with a genre validation error.

### UPL-016 — Safe generated physical filename

- [ ] Complete a successful upload and inspect the corresponding file and `tracks.storage_key`.
- [ ] Expected: Both use a version 4 UUID plus only the validated lowercase extension. The original filename is present only in metadata and is not part of the physical path.

### UPL-017 — Database failure rollback

- [ ] In a disposable development environment, simulate a database insert failure after the file write.
- [ ] Expected: The newly written physical file is removed, no track row remains, and the page shows only `Unable to upload the audio track. Please try again.` without internal paths or database details.

### UPL-018 — Refresh after success

- [ ] Complete a successful upload, then refresh the resulting `/tracks/{id}?uploaded=1` detail page.
- [ ] Expected: The detail page remains available and no additional file or database row is created.

## Additional upload and responsive checks

### UPL-019 — Upload without JavaScript

- [ ] Disable JavaScript in the browser, sign in, and submit a valid upload.
- [ ] Expected: The native multipart form completes, redirects to `/tracks/{newId}?uploaded=1`, and stores exactly one file and one metadata row.

### UPL-020 — Redirect to the created track

- [ ] Upload a valid track while signed in.
- [ ] Expected: The server responds with Post/Redirect/Get and the browser ends at `/tracks/{newId}?uploaded=1`.

### UPL-021 — Refresh after redirected upload

- [ ] Refresh the detail page reached after UPL-020.
- [ ] Expected: No duplicate track row or physical audio file is created.

## Public track browsing

### TRK-001 — Public list while signed out

- [ ] Sign out and open `/tracks`.
- [ ] Expected: The public track list is visible without authentication.

### TRK-002 — Existing public track

- [ ] Find `Party about you` on `/tracks`.
- [ ] Expected: Its title, artist, public metadata, owner username, and upload date are visible.

### TRK-003 — Public track detail

- [ ] Open a public track from its card.
- [ ] Expected: Safe metadata, the native audio player, a download link, and a link back to Browse Tracks are visible.

### TRK-004 — Invalid track ID

- [ ] Open `/tracks/not-a-number`, `/tracks/0`, and `/tracks/-1`.
- [ ] Expected: Each request returns a safe 404 without internal details.

### TRK-005 — Nonexistent track

- [ ] Open a valid positive integer track ID that does not exist.
- [ ] Expected: The page returns the same safe 404 used for an invalid or private track.

### TRK-006 — Private track

- [ ] In a disposable database, create a private track and open its numeric public ID directly.
- [ ] Expected: The page returns a safe 404 and does not reveal that the private record exists.

### TRK-007 — Empty public library

- [ ] Use a temporary test database with no public tracks and open `/tracks`.
- [ ] Expected: The page displays `No public tracks have been uploaded yet.`

## Audio streaming and player

### STR-001 — Play MP3

- [ ] Open an MP3 track detail page and press Play.
- [ ] Expected: Browser-native playback starts.

### STR-002 — Seek forward

- [ ] Move the native player to a later position.
- [ ] Expected: Playback resumes from the selected position.

### STR-003 — Seek network request

- [ ] Keep the browser Network panel open while seeking.
- [ ] Expected: The stream request contains a `Range` header and the response status is 206 with a correct `Content-Range`.

### STR-004 — Play WAV

- [ ] Open a WAV track and use the player.
- [ ] Expected: Playback works where the current browser supports the uploaded WAV encoding.

### STR-005 — Play OGG

- [ ] Open an OGG track and use the player.
- [ ] Expected: Playback works where the current browser supports the uploaded OGG encoding.

### STR-006 — Invalid byte range

- [ ] Request a range that starts at or beyond the physical file size.
- [ ] Expected: The endpoint returns 416 with `Content-Range: bytes */TOTAL` and no internal details.

### STR-007 — Missing physical file

- [ ] In a disposable environment, temporarily move the file for a public database row and request its stream.
- [ ] Expected: The endpoint returns a safe 404 without a filename or local path.

## Audio download

### DWN-001 — Ordinary original filename

- [ ] Download a public track whose original filename contains ordinary ASCII characters.
- [ ] Expected: The browser receives the original user-facing filename, not the generated UUID filename.

### DWN-002 — Filename with spaces

- [ ] Download a track whose original filename contains spaces.
- [ ] Expected: The suggested download filename remains usable and preserves the spaces.

### DWN-003 — Croatian filename

- [ ] Download a track whose original filename contains Croatian characters.
- [ ] Expected: The UTF-8 filename parameter preserves those characters and an ASCII fallback is also present.

### DWN-004 — Download security headers

- [ ] Inspect the download response headers.
- [ ] Expected: `Content-Disposition` is `attachment`, the type and actual length are correct, caching is conservative, and `X-Content-Type-Options` is `nosniff`.

### NAV-001 — Signed-in navigation at 320 px

- [ ] At a 320 px viewport width, sign in and inspect the header.
- [ ] Expected: Home, Browse Tracks, Upload, Account, the username label, and the POST Logout control remain visible or wrap cleanly and are all operable.
- [ ] Sign out at the same width.
- [ ] Expected: Home, Browse Tracks, Login, and Register remain operable.

### NAV-002 — Signed-out navigation

- [ ] Sign out and inspect the navigation at desktop and narrow widths.
- [ ] Expected: Home, Browse Tracks, Login, and Register are present and operable.

### NAV-003 — Signed-in navigation

- [ ] Sign in and inspect the navigation at desktop and narrow widths.
- [ ] Expected: Home, Browse Tracks, Upload, Account, the username, and POST Logout are present and operable.

## Public track search

### SRCH-001 — Exact title

- [ ] Open `/tracks`, enter the exact title of a public track in Search, and apply the filters.
- [ ] Expected: The matching public track appears and unrelated tracks do not.

### SRCH-002 — Partial title

- [ ] Search using a distinctive part of a public track title rather than the complete title.
- [ ] Expected: The matching public track appears because title matching supports partial text.

### SRCH-003 — Artist capitalization

- [ ] Search for a public track's artist using different uppercase or lowercase letters from the stored artist name.
- [ ] Expected: The matching public track appears because artist matching is case-insensitive.

### SRCH-004 — Description text

- [ ] Search for distinctive text that occurs only in a public track's description.
- [ ] Expected: The public track whose description contains that text appears.

### SRCH-005 — No search matches

- [ ] Search for text that does not occur in any public track title, artist, or description.
- [ ] Expected: The page remains available and displays `No public tracks match the selected search and filters.`

### SRCH-006 — Literal LIKE characters

- [ ] Search for text containing `%`, then repeat with text containing `_`.
- [ ] Expected: Each character is treated as literal search text rather than a SQL wildcard; the page does not fail or return unrelated wildcard matches.

## Public track filters

### FLT-001 — Minimum BPM

- [ ] Set Minimum BPM to a value shared by suitable test tracks and apply the filters.
- [ ] Expected: Every result with a specified BPM is equal to or higher than the minimum; tracks with a lower or unspecified BPM do not appear.

### FLT-002 — Maximum BPM

- [ ] Clear the other controls, set Maximum BPM, and apply the filters.
- [ ] Expected: Every result with a specified BPM is equal to or lower than the maximum; tracks with a higher or unspecified BPM do not appear.

### FLT-003 — Inclusive BPM range

- [ ] Set both Minimum BPM and Maximum BPM so tracks exist at the boundaries and inside the range.
- [ ] Expected: Only public tracks inside the inclusive range appear, including tracks exactly at either boundary; tracks with an unspecified BPM do not appear.

### FLT-004 — Invalid BPM

- [ ] Submit an out-of-range, decimal, or nonnumeric BPM value by editing the URL if browser input constraints prevent entry.
- [ ] Expected: The page returns normally without a server error, displays a clear BPM validation message, preserves appropriate submitted values, and does not run a misleading filtered query.

### FLT-005 — Inverted BPM range

- [ ] Set Minimum BPM to a value greater than Maximum BPM and apply the filters.
- [ ] Expected: The page displays `Minimum BPM cannot be greater than maximum BPM.` and does not return a misleading result set.

### FLT-006 — Musical key

- [ ] Select one musical key and apply the filters.
- [ ] Expected: Only public tracks with that exact stored musical key appear; tracks with other or unspecified keys do not.

### FLT-007 — Genre

- [ ] Select one genre and apply the filters.
- [ ] Expected: Only public tracks with that exact stored genre appear; tracks with other or unspecified genres do not.

### FLT-008 — Combined filters

- [ ] Enter search text and set a BPM range, musical key, and genre that one public test track satisfies, then apply the filters.
- [ ] Expected: Only public tracks matching every active condition appear; a track that fails any one condition does not.

## Public track sorting

### SRT-001 — Newest first

- [ ] Select Newest first and apply the filters.
- [ ] Expected: Results are ordered by newest upload first, with deterministic ordering for equal timestamps.

### SRT-002 — Oldest first

- [ ] Select Oldest first and apply the filters.
- [ ] Expected: Results are ordered by oldest upload first, with deterministic ordering for equal timestamps.

### SRT-003 — Title A–Z

- [ ] Select Title A–Z and apply the filters using tracks whose titles begin with different uppercase and lowercase letters.
- [ ] Expected: Results use a stable, case-insensitive alphabetical title order.

### SRT-004 — BPM ascending

- [ ] Select BPM low to high and apply the filters while tracks with numeric and unspecified BPM values are available.
- [ ] Expected: Numeric BPM values appear in ascending order and tracks with an unspecified BPM appear after them.

### SRT-005 — BPM descending

- [ ] Select BPM high to low and apply the filters while tracks with numeric and unspecified BPM values are available.
- [ ] Expected: Numeric BPM values appear in descending order and tracks with an unspecified BPM appear after them.

## Filter URL state

### URL-001 — Applied values in URL

- [ ] Apply search text, minimum and maximum BPM, musical key, genre, and a non-default sort.
- [ ] Expected: The address uses `/tracks` and contains one correctly encoded value for each active `q`, `bpmMin`, `bpmMax`, `musicalKey`, `genre`, and `sort` parameter.

### URL-002 — Refresh filtered URL

- [ ] Refresh the filtered URL from URL-001.
- [ ] Expected: The same results, current control values, active-filter summary, and sort order remain visible without resubmitting anything.

### URL-003 — Share filtered URL

- [ ] Copy the filtered URL, sign out or open a private browser window, and open the copied URL.
- [ ] Expected: The same public results and filter state appear without authentication.

### URL-004 — Reset filters

- [ ] Activate several filters, then use Reset filters.
- [ ] Expected: The browser navigates to `/tracks` without a query string, all controls return to their defaults, and the full public list appears.

## Search and filter privacy

### SEC-001 — Matching private track

- [ ] In a disposable environment, create a private track whose title, artist, description, BPM, musical key, and genre match the active search and filters exactly.
- [ ] Expected: The private track never appears in results, result counts, page data, or active-filter output, and the response reveals no internal UUID, stored filename, or physical path.

## Phase boundary

- [ ] Confirm upload is available only to signed-in users.
- [ ] Confirm public browsing, public detail, streaming, seeking, and download work without authentication.
- [ ] Confirm public search covers title, artist, and description; BPM, musical-key, and genre filters can be combined; and all five server-side sort options work.
- [ ] Confirm filter state is URL-driven, survives refresh and sharing, works without JavaScript, and can be reset to `/tracks`.
- [ ] Confirm Phase 6 features remain absent: pagination, My Tracks, metadata editing, audio-file replacement, deletion, visibility controls, automatic analysis, comments, ratings, playlists, and recommendations.

# Manual tests

These checks require a running MongoDB replica set, initialized application database, browser, two normal accounts, and at least one public and one private track. Results remain pending until they are performed against that environment.

| ID | Functionality | Prerequisite | Steps | Expected result | Actual result | Status |
| --- | --- | --- | --- | --- | --- | --- |
| ADM-01 | Normal registration role | Logged out | Register through `/register`, then inspect the user document | The new document has `role: "user"`; no role field is present in the form | Not run | Pending |
| ADM-02 | Legacy user compatibility | Existing user document without `role` | Log in with the legacy account and browse the application | Login and existing features work; the account is treated as `user` | Not run | Pending |
| ADM-03 | Logged-out admin page access | Logged out | Open `/admin`, `/admin/users`, and `/admin/tracks` | Each request redirects to the shared login page with a safe return URL | HTTP requests returned 303 to `/login` with the matching encoded `redirectTo` value | Pass |
| ADM-04 | Normal-user admin page access | Logged in as a normal user | Open each admin URL manually | Each request returns the application's 403 error page | Not run | Pending |
| ADM-05 | Normal-user direct admin action | Logged in as a normal user; known track ID | Submit `POST /admin/tracks?/delete` with that track ID using browser developer tools or an HTTP client with the user's cookie | Server rejects the action with 403 and the track remains unchanged | Not run | Pending |
| ADM-06 | Logged-out direct admin action | Logged out; known track ID | Submit the same POST without a session cookie | Server redirects to login; the track remains unchanged | HTTP POST returned 303 to the shared login route before the action could run | Pass |
| ADM-07 | Grant administrator | Existing normal account; trusted terminal | Run `npm run admin:grant -- user@example.com`, then refresh the application | Command succeeds, Admin navigation appears, and the same login/session is used | Not run | Pending |
| ADM-08 | Dashboard totals | Logged in as administrator | Open `/admin` and compare all five cards with MongoDB counts | User, total track, public track, private track, and playlist totals match MongoDB | Not run | Pending |
| ADM-09 | Safe user list | Logged in as administrator | Open `/admin/users` and inspect page data/network response | Username, email, normalized role, date, and track count appear; hashes and tokens do not | Not run | Pending |
| ADM-10 | All-track visibility | Logged in as administrator; another user's private track exists | Open `/admin/tracks` | Both public and private tracks from every owner appear; only public tracks have public detail links | Not run | Pending |
| ADM-11 | Delete confirmation | Logged in as administrator | Press Delete and cancel the browser confirmation | No request is submitted and the track remains | Not run | Pending |
| ADM-12 | Complete admin deletion | Another user's track belongs to one or more playlists and has audio plus a cover | Confirm Delete on `/admin/tracks`; verify MongoDB and private storage | Track metadata, all playlist-item references, audio file, and cover file are removed; success feedback appears | Not run | Pending |
| ADM-13 | Missing media during deletion | Track metadata exists but its audio or cover file is already missing | Delete the track as administrator | Database and playlist cleanup still completes without exposing filesystem paths | Not run | Pending |
| ADM-14 | Revoke administrator | Admin account; trusted terminal | Run `npm run admin:revoke -- user@example.com`, then refresh `/admin` | Command succeeds; Admin link disappears and `/admin` returns 403 | Not run | Pending |
| REG-01 | Authentication regression | Normal account | Register, log in, refresh, and log out | Existing authentication and session behavior remains unchanged | Not run | Pending |
| REG-02 | Track workflow regression | Normal account and sample MP3 | Upload, edit, play, seek, download, then owner-delete a track | Existing owner workflow and media delivery work as before | Not run | Pending |
| REG-03 | Browse regression | Public tracks exist | Search, combine filters, sort, and reset | Results and URL state behave as before | Not run | Pending |
| REG-04 | Playlist/player/theme regression | Normal account with playlist | Add/remove a track, use the persistent player across navigation, and toggle theme at desktop/mobile widths | Playlist, player, responsive layout, and theme behavior remain unchanged | Not run | Pending |

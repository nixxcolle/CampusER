# Keeping local and GitHub Pages consistent

The initial audit found identical active source files in the Desktop checkout and published site. The old service worker used a permanent cache and root-relative offline URLs, allowing old screens to remain visible and breaking offline loading below `/CampusER/`.

The app uses the same locally hosted Inter font, React/Lucide icons and Supabase client in every environment. Dependency sources and versions are recorded in `vendor/runtime-lock.json`.

After editing runtime files, run `node prepare-release.cjs` from the repository root. Commit the generated `index.html`, `sw.js`, `release-manifest.json` and every changed runtime asset together. Publish the repository root to GitHub Pages.

The release identifier appears in the HTML metadata and `release-manifest.json`. That manifest records exact file hashes for checking published files. HTML navigation checks the network first; versioned assets remain available offline. Old CAMPUS-ER caches are removed when the replacement worker activates. An already-open dashboard keeps its current session; refresh after deployment to show the latest release.

Run `node verify-release.cjs` with Playwright available to verify file hashes, root/subpath loading, fonts/icons, offline availability, API cache exclusion and responsive widths. Refreshing the vendored dependencies is a separate operation (`node vendor-runtime.cjs`), followed by release generation and browser checks.

## Raspberry Pi frontend

The same Incidents and Reports renderers serve both deployments. Include the Pi integration in the shared repository before deploying releases with the Pi updater. Run the updater manually to install each desired release from `main`.

GitHub Pages serves the repository's `campus-er-config.js`, which selects Supabase. The Pi backend serves its own response at the same path, selects Pi mode, and authorizes incident reads for the signed-in office. Keep the source selection script outside the static asset cache.

Deploy the files listed in `release-manifest.json` plus the manifest itself and `campus-er-config.js` into the Pi backend's frontend directory. Keep the backend's private database and staff settings on the Pi. Run `node verify-pi.cjs` when changing the Pi view. With Playwright available and Chrome installed, run `node verify-pi-browser.cjs` to check shared layouts, safe Pi fields, authentication and refresh behavior. After updating a Pi, confirm that the dashboard displays the Pi reports for an approved staff account.

The Pi reads its own PostgreSQL incidents while GitHub Pages reads Supabase. Database synchronization is a separate implementation step. Preserve full hardware Event IDs in the Pi data mapping. Older Pi APIs still show **Not tracked** and unavailable response counts; the response-workflow backend exposes saved statuses and receipts after its migration.

Emergency popups are created only by new-arrival events. Signing in, refreshing history, or repeating a poll does not add old records to the popup. Separate new events remain separate cards until their saved status is acknowledged or resolved. Closing the popup keeps those cards in the alert tray. Legacy Pi APIs retain the previous unavailable-status behavior; the frontend never invents a saved receipt.

## General broadcast and acknowledgment

General emergencies are visible to School Clinic, Campus Security, DRRMO and Administrator. Category-specific alerts remain restricted to their assigned office and Administrator. One incident is stored; its display label is **All authorized offices**. Staff access still comes from the existing authenticated profile/approved Pi office mapping.

The Incident Reports Acknowledge button saves a shared receipt with database time, authenticated user UUID and approved office. The first successful receipt is preserved during concurrent requests. Its status, Manila date/time and office appear in Reports history and incident details. There is no optimistic acknowledgment on a failed write, and legacy records without audit data are not assigned fabricated dates.

Incident Reports lists only active and pending incidents. Once acknowledgment is saved, the incident leaves that list on every dashboard and remains in Reports history with its original ID and receipt. Resolved incidents also remain outside the active list; no records are deleted or copied to another table.

For Supabase, review and apply `database/20261112_general_broadcast_acknowledgment.sql` using the project owner connection. It adds receipt fields, a narrow General SELECT policy for approved offices, an authenticated acknowledgment RPC and server-side stamping/immutability for existing status-update paths. It preserves existing office policies and uses the existing emergency-report realtime subscription/publication. Review any existing restrictive policies before activation. Test SQL/RLS in isolation with `node verification/response-database.cjs`.

For the Pi, follow `backend/README.md`: apply the additive migration and install the matching backend source before deploying the frontend. Approved staff receive immediate event-driven refreshes; polling remains a fallback. Old backends keep acknowledgment disabled until they advertise support. Supabase RPC failures also leave report status unchanged. Neither migration has been applied to production by preparing or publishing these files.

## Original hardware microphone audio

Voice playback never reads transcript text aloud. The dashboard uses the deployed Pi audio API: the ESP32 captures its physical INMP441 microphone and uploads a WAV to `POST /api/v1/reports/:eventId/audio` with its device credential. The backend verifies the owning station, validates the recording, and exposes `audio_available`, `audio_sha256` and `audio_duration_ms` in the report metadata. The existing backend and audio migration must already be installed; publishing frontend files does not install or flash device firmware.

The shared `pi-audio.js` requests the original WAV from the matching Event ID using the staff session and the existing office authorization. It checks the WAV header and SHA-256 against the report metadata before playback. Audio is fetched with `no-store`; temporary playback URLs are revoked and pending requests are cancelled on sign-out or loss of access. Keep private WAV files and all device/staff secrets out of this public repository.

New arrivals wait for their real audio attachment to become available through the existing Pi polling. Ready recordings play one at a time; simultaneous stations cannot replace each other's clips. Historical recordings never autoplay. Existing Play/Pause, volume and mute controls remain available. If browser autoplay is blocked, select the incident and press Play. Missing or invalid audio remains unavailable; there is no generated-voice fallback or dashboard-microphone capture.

The supplied Station 1 pilot firmware captures a **three-second, 16 kHz mono PCM16 clip for Medical presses**, with one clip held in RAM. It uploads the completed clip after the incident receipt. This is authentic recorded voice, **not continuous live streaming**. Other categories, continuous streaming, firmware flashing, microphone wiring/gain checks, and speech-to-text require their own hardware/backend integration and physical validation. GitHub Pages still reads Supabase; private Pi recordings are available in Pi mode and are not copied to the cloud by this frontend change.

Run `node verify-hardware-audio.cjs` with Playwright and Chrome to check browser WAV decoding, authenticated incident binding, checksum failures, delayed uploads, two-station playback, pause/resume, autoplay restrictions, invalid responses, mobile layout and session cleanup. That test generates isolated PCM fixtures; it does not prove physical microphone sound quality. The backend's `npm run test:audio` and `npm run test:staff` check the server-side storage and access rules without a live station.

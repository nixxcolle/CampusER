# General alerts and acknowledgment update

Automatic recording transcription is available through the [local transcription setup](TRANSCRIPTION.md). Install its matching backend, migration and PWA package to enable the saved-WAV queue and live transcript display.

This is the Pi backend source accompanying the shared dashboard. It keeps the existing station credentials, Supabase staff verification, office assignments, incident IDs, private WAV storage and device receipts. Do not put private configuration, database credentials, tokens or WAV files in this repository or the frontend directory.

General incidents remain a single stored incident and are readable by every approved office. Medical, Security and Fire/Disaster incidents retain their existing office restrictions; Administrator continues monitoring all incidents. The same authorization applies to recording playback.

`POST /api/v1/reports/:eventId/acknowledge` accepts the existing staff Bearer token and **no request body**. A single atomic database update records `response_status`, `acknowledged_at`, `acknowledged_by` and `acknowledged_office`. Concurrent acknowledgments preserve the first receipt. The actor and office come from verified staff access, and the timestamp comes from PostgreSQL. Repeated requests return that receipt without replacing its identity or time. Acknowledgment confirms receipt; it does not claim responders have been dispatched.

`GET /api/v1/events` is an authenticated, office-filtered server-sent event stream. It tells the dashboard to refresh after the Pi saves a new incident, recording or acknowledgment. General updates reach every approved office. Other categories reach their receiving office and Administrator. Connections expire after 25 seconds so reconnection rechecks staff access. The dashboard refreshes after reconnecting and checks every five seconds if live updates are unavailable or a report refresh fails. Events and staff API responses stay outside the offline cache.

## Update an existing Pi

1. Back up the current backend code and database. Keep `/home/thesis/CAMPUS-ER_Backend/dashboard-config.json`, the existing service environment and the private audio directory in place.
2. Apply `migrations/003_response_workflow.sql` to the existing Pi `campus_er` database as its owner. It adds columns and grants only their UPDATE privileges to the default `campus_er_app` role; existing rows and station IDs are preserved. For a custom application role, grant UPDATE on those four new columns to that role instead. The existing migrations 001 and 002 are prerequisites, not scripts to rerun against an established database.

   Existing Pi records begin in the new workflow as active/unacknowledged because the old API stored no response progress. No past acknowledgment dates or actors are invented, and loading those records never creates new-emergency popups.
3. Copy `server.js`, `response-workflow.js` and `audio.js` into the existing backend folder. Keep the original `staff-auth.js` and private configuration; their authentication contract is unchanged. Dependencies are unchanged from the supplied backend lockfile.
4. Update the shared frontend to the matching release, then restart the existing `campus-er-backend.service`. Confirm `/health` succeeds and `/api/v1/staff/session` returns `features.acknowledgements` and `features.live_updates` for an approved staff session.
5. Activate General on a physical station. Check all four signed-in office dashboards, acknowledge from one office, and confirm the same office and timestamp appear in every history view. Publishing GitHub Pages does not perform this Pi installation.

No production migration or service restart is performed by the tests. From the repository root, install test dependencies with `npm ci --prefix backend` and `npm ci --prefix verification`. Run `node verification/response-database.cjs` for the Supabase SQL/RLS checks and `node verification/response-workflow.cjs` with Playwright/Chrome available for the real PostgreSQL + HTTP + four-browser workflow. `node --test backend/audio.test.js backend/staff-auth.test.js` checks the existing audio and authentication rules.

The Pi and Supabase remain separate data sources. This update does not add replication between them. All offices connected to the same source receive consistent reports and receipts. Apply the separate Supabase migration in `../database` for the cloud deployment.

# Campus station inventory

Applied through the existing Supabase SQL Editor to project `tqdalphmeycgrfaxxbqk` on October 30, 2026. The final SQL result verified six buildings, each with 17 station locations, 3 floors, and 17 distinct rooms (102 locations total). All newly inserted stations are offline; none are claimed to be connected hardware.

## Schema

The inspected stations table already had `id` (bigint identity), `station_id`, `building`, `floor`, `room`, `status`, and `created_at`. The additive migration adds `floor_number` and `room_status`, with constraints and a unique non-null `station_id` index. Existing primary keys, access policies, authentication, and emergency-report subscriptions are unchanged. Seed reruns update canonical location fields but preserve existing station/room statuses and IDs. No existing rows are deleted.

`station_id` is the stable hardware-facing label, e.g. `SSU-COENG-3-301`. Numeric `id` remains the database primary key. Existing station-picker UI paths now stringify numeric IDs before comparisons or display operations.

Each building has Dean's Office, Faculty Room, and Rooms 101–105 on floor 1, Rooms 201–205 on floor 2, and Rooms 301–305 on floor 3. Codes: COED, OLD-CAS, CONHS, CAS, COENG, CIT. Source: `../campus-structure.json`. Run `node generate-campus-data.cjs` in the project root to regenerate the browser inventory and CSV/JSON exports. Do not import the CSV after running the migration; it represents the same locations.

## Map status definitions

- Building: Emergency Active if an unresolved visible report matches the building; otherwise Online if any registered station is online, otherwise Offline.
- Station: Online, Offline, or Maintenance, based on its reported status. Unregistered planned locations are explicitly labeled and never counted online.
- Room: Active Emergency when an unresolved report matches building, floor, and room; otherwise Out of Service for an explicit `room_status='out_of_service'`; otherwise Normal. Emergency state is derived, so resolved reports do not leave stale emergency room flags.
- Active Stations counts online registered stations. Active Rooms counts distinct rooms with an online station, excluding Out of Service rooms. A Normal room with an offline station is not counted as actively monitored.

Map positions are schematic, based on the supplied sketch; CIT's exact footprint is illustrative. COED and College of Education, and Engineering Building and College of Engineering, are recognized aliases. Old CAS and College of Arts and Sciences remain distinct. Unmatched legacy reports are retained and disclosed on the map page instead of being reassigned to a different building.

Report building/floor choices and room suggestions now use this inventory. Selecting a station fills its location. Existing legacy report values remain available when editing a loaded legacy report. Emergency routing and report CRUD queries are unchanged.

## Verification

`node verify-campus.cjs` checks 102 unique station IDs, 7/5/5 floor counts, six summary cards, floor drill-down, room-specific emergency focus, maintenance and room service states, numeric station selection, map reset, and mobile overflow. Browser tests mock Supabase and do not change live reports or station telemetry. Live seeding was separately verified in the authenticated SQL Editor.

A read-only request to the stations REST endpoint with the existing embedded client key returned HTTP 200 and zero visible rows without a user session. The SQL Editor independently returned all 102 records. No access policies were changed to expose these records; authenticated visibility remains governed by the existing Supabase permissions. The REST root schema endpoint's HTTP 401 requires a privileged key and was not an invalid-client-key error. Client keys and authentication configuration remain unchanged.

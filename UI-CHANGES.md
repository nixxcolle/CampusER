# CAMPUS-ER presentation update

The original inline application script in `index.html` is unchanged. Supabase initialization, authentication, queries, CRUD, role routing, and realtime subscriptions retain their existing implementation.

New presentation files:

- `eoc.css`: white EOC theme, office accents, responsive layout, focus styles, reduced-motion support, toast and map styling.
- `eoc-polish.css`: stronger office accents, alert hierarchy, response controls, simulated voice player, and always-visible priority.
- `eoc-monitor.css` / `eoc-monitor.js`: office-colored workspace and sidebar themes, visible routing matrix, receiving-office-only demo visibility, Administrator monitoring table and campus-wide incident map, and four response stages.
- `eoc.js`: overview and schematic map rendering, local simulation state, and toast presentation. Simulation data never enters `liveIncidents`; demo response actions update only the preview.
- `eoc-icons.mjs`: Lucide React SVG icons rendered into small React roots, including legacy UI text icons. React 18.3.1 and Lucide React 0.468.0 load through esm.sh.

The overview has an empty state rather than displaying the original fallback demonstration incident. Existing backend fallback functions remain unchanged. AI priority comes from the report and remains visible; only recommendations collapse. Recommendations still use the existing generator.

Response controls sit below the emergency card. Demo Acknowledge, Dispatch Responders, and Resolve update only the preview. Demo dispatch shows “Responders on the way” with a simulation label. Live dispatch uses the existing acknowledged-status update and displays “Dispatch requested / Awaiting responder confirmation”; it does not assert that personnel are physically responding. This UI-only request indication is local to the current browser session, not a shared student-facing status.

Administrator overview is a central monitor: it displays all available live reports and demo reports, office workloads, report acknowledgements, delivery evidence, and response progress. Rescue controls are omitted from this overview. Existing navigation and CRUD pages remain intact. General emergencies retain their existing Administrator assignment. No actual delivery receipts, vehicle locations, historical activity log, or arrival telemetry are invented.

Each demo alert is kept in a local in-memory preview store and is shown only in the assigned office and Administrator. Role switches preserve the preview so an operator can demonstrate delivery and monitoring in the same browser; previews do not synchronize across tabs or users. Existing Supabase filters remain unchanged. Presentation-only audio/toast guards suppress unrelated office alerts without changing realtime subscriptions. The four stages are Alert Received, Responders Notified, Team En Route, and Responders Arriving. Demo Dispatch advances to Team En Route; Preview responders arriving completes the mock arrival stage. Unavailable live confirmations stay pending.

Voice reports are a hardware mockup as requested. The simulation tools let the operator choose English, Filipino/Tagalog, or Waray-Waray samples. A predefined transcript appears immediately and speech synthesis starts automatically unless muted. This simulates hardware audio and transcription; it does not record or transcribe actual speech. Voice pronunciation depends on installed browser/OS voices. Missing voice support or autoplay errors produce a retry notification; the transcript remains readable. The voice panel shows only the simulated recording player and transcript. Real reports continue to display their existing voice_transcript value; no audio URL, hardware feed, transcription API, or database fields were added.

The campus map is schematic, not a surveyed geographic map. It shows all buildings normally and focuses the selected active incident when a matching building exists.

Verification: `node verify-ui.cjs` uses Playwright with installed Chrome, mocks Supabase and speech playback, blocks database requests, compares the original application script, and checks all office dashboards, automatic narration in all three sample languages, demo response transitions, live dispatch success/failure, visible priorities, collapsed recommendations, existing pages, and mobile overflow. Screenshots are saved as `preview-desktop.png`, `preview-emergency.png`, `preview-mobile.png`, and one preview per office. The unchanged inline application script is compared against the Desktop copy.

The verification also covers all sixteen emergency/office visibility combinations, Administrator's four-office monitor, arrival previews, and distinct Science versus Arts and Sciences map locations. Chapter-1.pdf was not present; the routing description supplied in the request was used alongside existing routing constants.

Serve over HTTP(S) for module loading. Existing service-worker caching may require a hard reload or clearing site data to show the updated HTML. No live backend or physical emergency hardware was exercised.

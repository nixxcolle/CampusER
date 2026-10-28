# CAMPUS-ER presentation update

The original inline application script in `index.html` is unchanged. Supabase initialization, authentication, queries, CRUD, role routing, and realtime subscriptions retain their existing implementation.

New presentation files:

- `eoc.css`: white EOC theme, office accents, responsive layout, focus styles, reduced-motion support, toast and map styling.
- `eoc.js`: overview and schematic map rendering, local simulation state, and toast presentation. Simulation data never enters `liveIncidents`; response actions are disabled during previews.
- `eoc-icons.mjs`: Lucide React SVG icons rendered into small React roots, including legacy UI text icons. React 18.3.1 and Lucide React 0.468.0 load through esm.sh.

The overview now has an empty state rather than displaying the original fallback demonstration incident. Existing backend fallback functions remain unchanged. The AI panel displays existing generated recommendations and keywords; its underlying analysis is unchanged. Transcript playback retains existing speech synthesis behavior.

The campus map is schematic, not a surveyed geographic map. It shows all buildings normally and focuses the selected active incident when a matching building exists.

Verification: `node verify-ui.cjs` uses Playwright with installed Chrome, mocks Supabase, blocks database requests, compares the original application script, and checks empty states, all four simulations, map focus, AI expansion, office roles, existing pages, and mobile overflow. Screenshots are saved as `preview-desktop.png`, `preview-emergency.png`, and `preview-mobile.png`. The verification compares against the original Desktop source, so run before installing or point its baseline at the saved backup afterward.

Serve over HTTP(S) for module loading. Existing service-worker caching may require a hard reload or clearing site data to show the updated HTML. No live backend or physical emergency hardware was exercised.

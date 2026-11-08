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

The Pi reads its own PostgreSQL incidents while GitHub Pages reads Supabase. Database synchronization is a separate implementation step. Preserve full hardware Event IDs in the Pi data mapping. Show **Not tracked** for unavailable Pi response status and a dash for response metrics the Pi cannot calculate.

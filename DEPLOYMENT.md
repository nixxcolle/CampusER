# Keeping local and GitHub Pages consistent

The initial audit found identical active source files in the Desktop checkout and published site. The old service worker used a permanent cache and root-relative offline URLs, allowing old screens to remain visible and breaking offline loading below `/CampusER/`.

The app now uses the same locally hosted Inter font, React/Lucide icons and Supabase client in every environment. Authentication, queries, routing, incident actions and realtime handlers are unchanged. Dependency sources and versions are recorded in `vendor/runtime-lock.json`.

After editing runtime files, run `node prepare-release.cjs` from the repository root. Commit the generated `index.html`, `sw.js`, `release-manifest.json` and every changed runtime asset together. Publish the complete repository root to GitHub Pages. Use the same checkout for local serving; do not copy only the HTML file.

The release identifier appears in the HTML metadata and `release-manifest.json`. That manifest records exact file hashes for checking published files. HTML navigation checks the network first; versioned assets remain available offline. Old CAMPUS-ER caches are removed when the replacement worker activates. An already-open dashboard keeps its current session; refresh after deployment to show the latest release.

Run `node verify-release.cjs` with Playwright available to verify file hashes, root/subpath loading, fonts/icons, offline availability, API cache exclusion and responsive widths. The test's Playwright path can be changed to the local installation. Refreshing the vendored dependencies is a separate deliberate operation (`node vendor-runtime.cjs`), followed by release generation and browser checks.

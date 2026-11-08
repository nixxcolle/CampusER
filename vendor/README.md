# Browser runtime assets

The existing client packages and Inter font files are served from this directory so network access to font/icon CDNs cannot change the interface between environments. `runtime-lock.json` records upstream package versions, URLs, and SHA-256 digests. Package copyright/license notices remain in downloaded modules. React and React DOM use 18.3.1; Lucide React uses 0.468.0. The Supabase UMD browser client was captured from the same existing jsDelivr v2 URL; its resolved version is recorded in the lock file. No service-role/secret key is included.

Run `node vendor-runtime.cjs` only when deliberately refreshing dependencies, then run `node prepare-release.cjs`. Normal deployment does not redownload libraries.

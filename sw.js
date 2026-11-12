/* Generated release values; requests to authentication/API services are never cached. */
const RELEASE = '5417e84f1fd515ed';
const CACHE = 'campus-er-assets-' + RELEASE;
const FILES = [
  "campus-data.js",
  "campus-map.css",
  "campus-map.js",
  "emergency-attention.css",
  "emergency-attention.js",
  "eoc-brand.css",
  "eoc-icons.mjs",
  "eoc-insights.css",
  "eoc-insights.js",
  "eoc-monitor.css",
  "eoc-monitor.js",
  "eoc-polish.css",
  "eoc-signin.css",
  "eoc.css",
  "eoc.js",
  "images/SSU.png",
  "images/SSULOGO.png",
  "index.html",
  "manifest.json",
  "pi-audio.js",
  "pi-dashboard.css",
  "pi-dashboard.js",
  "records-design.css",
  "records-design.js",
  "response-workflow.js",
  "vendor/fonts/1b08e7fc267a5c7e1d61.ttf",
  "vendor/fonts/8c883f63b2c4157d9973.ttf",
  "vendor/fonts/b37284b5701b6b168dfc.ttf",
  "vendor/fonts/d0f4bc7faca468376e3d.ttf",
  "vendor/fonts/e7a1aaf7eda9f2fad413.ttf",
  "vendor/inter.css",
  "vendor/lucide-react.mjs",
  "vendor/modules/0d42069a92e991f0762e.mjs",
  "vendor/modules/12a1c52fb6f752269fe4.mjs",
  "vendor/modules/15f7b5b3574fe4017dbb.mjs",
  "vendor/modules/16a91057b21f1b968801.mjs",
  "vendor/modules/57d672fc02832810b61a.mjs",
  "vendor/modules/7276bbcbdea69e43300c.mjs",
  "vendor/modules/8394cd637e0fc9a263d8.mjs",
  "vendor/modules/aae02972ae474f9835ff.mjs",
  "vendor/modules/d4f2f59f0170ceff8542.mjs",
  "vendor/react-dom-client.mjs",
  "vendor/react.mjs",
  "vendor/supabase.min.js"
];
const scope = new URL(self.registration.scope);
const assetPaths = new Set(FILES.map(file => new URL(file, scope).pathname));
const keyFor = request => { const url = new URL(typeof request === 'string' ? request : request.url, scope); if (!url.searchParams.has('v')) url.searchParams.set('v', RELEASE); return url.href; };
const indexKey = keyFor('index.html');
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(FILES.map(file => new Request(keyFor(file), { cache: 'reload', credentials: 'same-origin' })));
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name !== CACHE && (name === 'campus-er-v1' || name.startsWith('campus-er-assets-') || name.startsWith('campus-er-static-'))) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const relativePath = url.pathname.slice(scope.pathname.length);
  if (relativePath === 'campus-er-config.js' || relativePath.startsWith('api/') || relativePath.startsWith('auth/')) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request, { cache: 'no-store' });
        if (!response.ok) throw new Error('Navigation HTTP ' + response.status);
        if (response.headers.get('content-type')?.includes('text/html')) {
          const html = await response.clone().text();
          if (html.includes('name="campus-er-release" content="' + RELEASE + '"')) await cache.put(indexKey, response.clone());
        }
        return response;
      } catch (error) { const saved = await cache.match(indexKey); if (saved) return saved; return new Response('Campus workspace is offline. Reconnect and refresh.', { status: 503, headers: { 'content-type': 'text/plain' } }); }
    })());
    return;
  }
  if (!assetPaths.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE), key = keyFor(request);
    const saved = await cache.match(key); if (saved) return saved;
    const response = await fetch(request, { cache: 'no-cache' });
    if (response.ok) await cache.put(key, response.clone());
    return response;
  })());
});

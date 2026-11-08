/* Generated release values; requests to authentication/API services are never cached. */
const RELEASE = '__RELEASE__';
const CACHE = 'campus-er-assets-' + RELEASE;
const FILES = __FILES__;
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
  for (const name of await caches.keys()) if (name !== CACHE && (name === 'campus-er-v1' || name.startsWith('campus-er-assets-'))) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
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

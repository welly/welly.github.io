// Service worker: keeps a copy of Mock QSO so it opens and makes QSOs without a connection.
//
// scripts/publish-web.sh replaces VERSION with the commit it publishes. The page (index.html) is fetched from
// the network first, so a new version is picked up whenever there is a connection; everything else is stamped
// with ?v=VERSION and served from the cache. A new version installs alongside and the old cache is dropped.

const VERSION = '3605178';
const CACHE = `mockqso-${VERSION}`;
const v = `?v=${VERSION}`;
const FILES = [
  './',
  `app.js${v}`, `worker.js${v}`, `engine.js${v}`, `mockqso.wasm${v}`,
  'icon.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('mockqso-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return; // usage counts go straight out

  if (request.mode === 'navigate') {
    // The page: the network when there is one (so updates arrive), else the copy. Settings and QSO links
    // (?kind=…, ?qso=…) are all the same page.
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) (await caches.open(CACHE)).put('./', response.clone());
        return response;
      } catch {
        return (await caches.match('./', { cacheName: CACHE })) ?? Response.error();
      }
    })());
    return;
  }

  // Everything else is versioned or never changes: the copy if there is one, else the network.
  event.respondWith((async () => (await caches.match(request, { cacheName: CACHE })) ?? fetch(request))());
});

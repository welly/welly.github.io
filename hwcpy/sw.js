// Service worker: keeps a copy of HW CPY, built-in sets included, so it opens and plays without a connection.
//
// scripts/publish-web.sh replaces VERSION with the commit it publishes. The page (index.html) is fetched from
// the network first, so a new version is picked up whenever there is a connection; everything else is stamped
// with ?v=VERSION and served from the cache. A new version installs alongside and the old cache is dropped.
// sets.bin (about 6 MB) is fetched whole in the background once the rest is cached; until then built-in sets
// come from the network with range requests, and afterwards the cached copy answers those ranges itself.

const VERSION = '420fc83';
const CACHE = `hwcpy-${VERSION}`;
const v = `?v=${VERSION}`;
const FILES = [
  './',
  `app.js${v}`, `engine.js${v}`, `hwcpy.wasm${v}`, `sets/catalog.json${v}`,
  'icon.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest', 'LICENSE.txt',
];
const SETS = `sets/sets.bin${v}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('hwcpy-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
  // Not waited for: the page works meanwhile.
  caches.open(CACHE).then(async (cache) => { if (!(await cache.match(SETS))) await cache.add(SETS); }).catch(() => { });
});

/// Answers a range request from the whole file in the cache.
async function rangeFrom(cached, range) {
  const buffer = await cached.arrayBuffer();
  const m = /bytes=(\d+)-(\d*)/.exec(range ?? '');
  if (!m) return new Response(buffer, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
  const start = Number(m[1]);
  const end = m[2] ? Math.min(Number(m[2]), buffer.byteLength - 1) : buffer.byteLength - 1;
  return new Response(buffer.slice(start, end + 1), {
    status: 206,
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${start}-${end}/${buffer.byteLength}` },
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;

  if (request.mode === 'navigate') {
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

  if (url.pathname.endsWith('/sets/sets.bin')) {
    event.respondWith((async () => {
      const cached = await caches.match(SETS, { cacheName: CACHE });
      return cached ? rangeFrom(cached, request.headers.get('Range')) : fetch(request);
    })());
    return;
  }

  event.respondWith((async () => (await caches.match(request, { cacheName: CACHE })) ?? fetch(request))());
});

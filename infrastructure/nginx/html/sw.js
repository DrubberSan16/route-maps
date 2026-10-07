// Service worker of the installable viewer (Route Maps as a web app).
//
// The page, its modules, MapLibre, the font, the style and the icons are kept in a cache named
// after their content (__BUILD__ is replaced when the Nginx image is built), so the map opens at
// once, also with a weak connection, and a new release replaces the whole set at the same time.
// Label glyphs are kept once used, until the next release. The API and the PMTiles archives (read
// with Range requests) always go to the network: the browser caches the archives by itself.
const BUILD = '__BUILD__';
const SHELL = `route-maps-shell-${BUILD}`;
const GLYPHS = `route-maps-glyphs-${BUILD}`;
const SHELL_FILES = [
  '/',
  '/viewer.css',
  '/viewer.js',
  '/sdk/map-style.js',
  '/sdk/map-icons.js',
  '/vendor/maplibre-gl.mjs',
  '/vendor/maplibre-gl-shared.mjs',
  '/vendor/maplibre-gl-worker.mjs',
  '/vendor/maplibre-gl.css',
  '/vendor/pmtiles.js',
  '/vendor/fonts/inter-latin-wght-normal.woff2',
  '/maps/style/style.json',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/map-type-map.webp',
  '/icons/map-type-satellite.webp',
  '/icons/map-type-relief.webp',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // Revalidated with the server (ETag): the HTTP cache could still hold the previous release.
    await cache.addAll(SHELL_FILES.map((url) => new Request(url, { cache: 'no-cache' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('route-maps-') && name !== SHELL && name !== GLYPHS) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && url.pathname === '/') {
    event.respondWith(shell('/', request));
  } else if (SHELL_FILES.includes(url.pathname) && !url.search) {
    event.respondWith(shell(url.pathname, request));
  } else if (url.pathname.startsWith('/maps/fonts/')) {
    event.respondWith(glyphs(request));
  }
  // Anything else (API, PMTiles, downloads, other pages): the network, as without a worker.
});

async function shell(path, request) {
  const cached = await caches.match(path, { cacheName: SHELL });
  if (cached) return cached;
  try {
    return await fetch(request);
  } catch (error) {
    // Offline and not cached yet (first visit cut short): the page, if there is one.
    return (await caches.match('/', { cacheName: SHELL })) ?? Promise.reject(error);
  }
}

async function glyphs(request) {
  const cache = await caches.open(GLYPHS);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

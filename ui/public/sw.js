/* ShiftPlanner service worker: makes the app installable and keeps a person's
 * own upcoming shifts readable offline.
 *
 * - Navigations: network first, the cached app shell when offline.
 * - Built assets (hashed files, fonts, icons): cache first.
 * - A short allow-list of read-only API calls — who I am, the shifts, my own
 *   confirmed roster, my change notices: network first, the last good answer when offline.
 * Everything else (writes, other API calls) always goes to the network.
 * Cached API answers are dropped when the page tells us the person signed out. */
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const DATA = `data-${VERSION}`;

const OFFLINE_API = [
  /^\/api\/v1\/self$/,
  /^\/api\/v1\/shifts$/,
  /^\/api\/v1\/workstations$/,
  /^\/api\/v1\/employees\/email\/[^/]+$/,
  /^\/api\/v1\/employees\/[^/]+\/confirmed-shift-plans$/,
  /^\/api\/v1\/roster-change-notices$/,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.add(new Request(new URL('./', self.registration.scope), { cache: 'reload' })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, ASSETS, DATA].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'clear-data') event.waitUntil(caches.delete(DATA));
});

async function networkFirst(request, cacheName, fallbackKey) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(fallbackKey ?? request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(fallbackKey ?? request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL, new Request(new URL('./', self.registration.scope))));
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    if (OFFLINE_API.some((re) => re.test(url.pathname))) {
      event.respondWith(networkFirst(request, DATA));
    }
    return;
  }
  if (/\.(?:js|css|woff2?|png|svg|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

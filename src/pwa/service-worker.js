// The service worker: it keeps a copy of every file of the game on the device, so the game starts fast and also runs with no internet. This file is not part of the game's bundle. The build copies it to "sw.js" next to the page and puts the list of files, with a fingerprint of each file's content, in place of the mark below (scripts/build-service-worker.mjs).
/* __PRECACHE__ */

/** One cache for all versions. Each file is stored under its address plus its fingerprint, so a file that did not change is not downloaded again, and a new version never overwrites a file that an open page of the old version still uses. */
const CACHE = 'robot-chess';
const SCOPE = new URL(self.registration.scope);
const fileUrl = (path) => new URL(path, SCOPE).href;
const cacheKey = (path) => `${fileUrl(path)}?v=${PRECACHE.files[path]}`;

/** The address of a request the way the file list writes it, or null when the request is not for a file of the game. A page load has the address of the folder, with or without "index.html", and may carry a query. */
function listedPath(address) {
  const url = new URL(address);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return null;
  const inside = url.pathname.slice(SCOPE.pathname.length);
  const path = inside === '' || inside === 'index.html' ? './' : inside;
  return Object.hasOwn(PRECACHE.files, path) ? path : null;
}

// A new version: download what the device does not have yet. If one file fails, the whole step fails and the browser tries again later; the version in use is not touched.
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        Object.keys(PRECACHE.files).map(async (path) => {
          if (await cache.match(cacheKey(path))) return;
          // "no-cache" makes the browser check with the host before it uses a copy from its own HTTP cache. Without it an old copy of a file whose name never changes, like the page, could be stored as the new version.
          const response = await fetch(fileUrl(path), { cache: 'no-cache' });
          if (!response.ok) throw new Error(`[sw] Could not download ${path}: HTTP ${response.status}`);
          // A redirected answer may not be used to open a page, so it is stored as a plain answer with the same content.
          const plain = response.redirected ? new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers }) : response;
          await cache.put(cacheKey(path), plain);
        }),
      );
    })(),
  );
});

// The new version takes over. The browser starts this step only when no page of the old version is open any more, so the old files can go now.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const wanted = new Set(Object.keys(PRECACHE.files).map(cacheKey));
      for (const request of await cache.keys()) if (!wanted.has(request.url)) await cache.delete(request);
      // On the first visit the page was loaded before the worker existed. Taking it over now lets that page use the stored files too.
      await self.clients.claim();
    })(),
  );
});

// Files of the game come from the device. Everything else, and a file the device has lost, goes to the network as usual.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const path = listedPath(event.request.url);
  if (path === null) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match(cacheKey(path))) ?? fetch(event.request);
    })(),
  );
});

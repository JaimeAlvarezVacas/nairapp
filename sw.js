// User data is in localStorage, not here. Bump only if FILES changes.
const CACHE = 'comidas-4';
const FILES = ['./', 'index.html', 'logic.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'];

self.addEventListener('install', e => {
  // reload skips the HTTP cache, which could otherwise mix old and new files in one version
  const requests = FILES.map(f => new Request(f, { cache: 'reload' }));
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(requests)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first, so a new version shows up on the next open; the cache is the offline fallback.
// shortcut: no timeout, a very slow connection waits for the network; add one if it feels slow.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' })
    .then(response => {
      if (response.ok) {
        const copy = response.clone();
        e.waitUntil(caches.open(CACHE).then(c => c.put(e.request, copy)));
      }
      return response;
    })
    .catch(() => caches.match(e.request, { ignoreSearch: true })
      .then(hit => hit || Response.error())));
});

// Bump on every publish so phones pick up the new files. User data is in localStorage, not here.
const CACHE = 'comidas-3';
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

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});

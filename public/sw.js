// Deliberately minimal. This does NOT cache Next.js's hashed JS/CSS
// chunks or API/Supabase responses — a cache-first strategy on those is
// the classic way a service worker ends up serving a stale, broken app
// after a deploy. All this does is:
//  1. make the app installable (a manifest + a fetch handler is what
//     browsers require for "Add to Home Screen"), and
//  2. show a friendly offline page instead of the browser's own error
//     when a full page navigation fails with no network.
// Anything already in flight (an open practice session) is unaffected —
// that's the browser's normal HTTP cache and the app's own localStorage
// pause/resume, not this worker.

const CACHE = 'pastcs-shell-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(OFFLINE_URL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return; // let everything else hit the network normally

  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE_URL))
  );
});

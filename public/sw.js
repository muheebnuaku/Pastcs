// Deliberately minimal. This does NOT cache Next.js's hashed JS/CSS
// chunks or API/Supabase responses — a cache-first strategy on those is
// the classic way a service worker ends up serving a stale, broken app
// after a deploy. All this does is:
//  1. make the app installable (a manifest + a fetch handler is what
//     browsers require for "Add to Home Screen"), and
//  2. show a friendly offline page instead of the browser's own error
//     when a full page navigation fails with no network, and
//  3. show web push notifications on the phone, even when the app is
//     closed.
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

// Every notification: classroom calls and @mentions (sent by
// /api/classrooms/push) and everything else in the bell (sent by
// /api/push/drain). The phone shows it on the lock screen and as a
// pop-up like any app's; badge-96.png is the white owl Android puts in
// the status bar. Tapping one opens its page, reusing a PastCS window if
// one is open.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const url = typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : '/dashboard';
  const shown = self.registration.showNotification(data.title || 'PastCS', {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: data.tag,
    renotify: !!data.tag,
    vibrate: [180, 80, 180],
    timestamp: Date.now(),
    data: { url },
  });
  // The unread count on the home-screen icon, like WhatsApp's.
  const badge = typeof data.badgeCount === 'number' && self.navigator.setAppBadge
    ? self.navigator.setAppBadge(data.badgeCount).catch(() => {})
    : Promise.resolve();
  event.waitUntil(Promise.all([shown, badge]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/dashboard', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.location.origin));
      if (open) return open.navigate(url).then((w) => (w || open).focus());
      return self.clients.openWindow(url);
    })
  );
});

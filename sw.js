/* ═══════════════════════════════════════════════════════
   PageTurn — Service Worker
   Handles: caching, background push, reminder alarms
   ═══════════════════════════════════════════════════════ */

const CACHE_NAME = 'pageturn-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/* ── Install: cache shell assets ── */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

/* ── Activate: clear old caches ── */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch: serve from cache, fall back to network ── */
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});

/* ── Push: native push notification from server (future use) ── */
self.addEventListener('push', (e) => {
  const data = e.data ? e.data.json() : {};
  const title = data.title || '📖 Time to Read!';
  const opts = {
    body: data.body || 'Continue your reading session',
    icon: './icons/icon-192.png',
    badge: './icons/icon-96.png',
    tag: 'pageturn-reminder',
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200],
    actions: [
      { action: 'read',   title: '📚 Start Reading' },
      { action: 'snooze', title: '💤 Snooze 15 min'  },
    ],
    data: data,
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

/* ── Notification click handler ── */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const action = e.action;

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      /* Try to focus an existing window */
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({ type: 'NOTIF_ACTION', action });
          return client.focus();
        }
      }
      /* Otherwise open a new window */
      if (clients.openWindow) {
        return clients.openWindow('/?action=' + action);
      }
    })
  );
});

/* ── Notification close (dismissed) ── */
self.addEventListener('notificationclose', (e) => {
  /* Inform open clients the notification was dismissed */
  clients.matchAll({ type: 'window' }).then((clientList) => {
    clientList.forEach((c) => c.postMessage({ type: 'NOTIF_DISMISSED' }));
  });
});

/* ═══════════════════════════════════════════════════════
   BACKGROUND ALARM ENGINE
   The page sends a "SCHEDULE" message with a delay.
   The SW sets a real timeout so the reminder fires even
   when the tab is backgrounded / screen is off (Android).
   On iOS, we fall back to the in-page timer + visibility API.
   ═══════════════════════════════════════════════════════ */

let alarmTimer = null;

self.addEventListener('message', (e) => {
  const { type, delayMs, book, page, total, pct } = e.data || {};

  if (type === 'SCHEDULE_ALARM') {
    /* Cancel any existing alarm */
    if (alarmTimer) clearTimeout(alarmTimer);

    alarmTimer = setTimeout(() => {
      alarmTimer = null;
      const title = '📖 Time to Read!';
      const body  = book
        ? `Continue "${book}" — page ${page} of ${total} (${pct}%)`
        : 'Your reading reminder is here!';

      self.registration.showNotification(title, {
        body,
        icon:              './icons/icon-192.png',
        badge:             './icons/icon-96.png',
        tag:               'pageturn-reminder',
        renotify:          true,
        requireInteraction: true,
        vibrate:           [200, 100, 200, 100, 200],
        actions: [
          { action: 'read',   title: '📚 Start Reading' },
          { action: 'snooze', title: '💤 Snooze 15 min'  },
        ],
        data: { book, page, total, pct },
      }).catch(() => {
        /* Notifications not available — wake up any open client instead */
        clients.matchAll({ type: 'window' }).then((cl) =>
          cl.forEach((c) => c.postMessage({ type: 'FIRE_IN_PAGE' }))
        );
      });

      /* Also wake up in-page popup for when app is in foreground */
      clients.matchAll({ type: 'window' }).then((cl) =>
        cl.forEach((c) => c.postMessage({ type: 'FIRE_IN_PAGE' }))
      );
    }, delayMs);
  }

  if (type === 'CANCEL_ALARM') {
    if (alarmTimer) { clearTimeout(alarmTimer); alarmTimer = null; }
  }
});

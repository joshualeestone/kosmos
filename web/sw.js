'use strict';
/* Kosmos service worker (#718: the push third of Josh's push + icon + store).
 *
 * Served at /sw.js by server.js so its scope is the whole origin (/) -- push
 * subscription and the offline app-shell both need root scope. Three jobs:
 *   1. Cache the app shell so an installed PWA opens offline to the last board.
 *   2. Show a notification when a push arrives from the coordinator.
 *   3. Focus (or open) the board when that notification is clicked.
 *
 * Live account data is NEVER cached here: /api/* and /v1/* pass straight to the
 * network. The whole app is one no-store HTML file, so navigations are
 * network-first (freshest board when online) and fall back to the cached shell
 * only when the network is unreachable.
 */

const SHELL_CACHE = 'kosmos-shell-v1';

/* The shell is the one HTML file (served at /) plus the manifest and the two
   install icons the manifest names. Everything else is live data over the
   network. */
const SHELL_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/icons/kosmos-192.png',
  '/icons/kosmos-512.png',
];

self.addEventListener('install', (event) => {
  /* The board is a single long-lived tab; take over as soon as ready rather
     than waiting for every tab to close. */
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      // A cold install with no network must still install: the fetch handler
      // falls back to the network, so a failed pre-cache is not fatal.
      .catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop shell caches from prior worker versions.
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== SHELL_CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;               // never touch writes
  let url;
  try { url = new URL(req.url); } catch (_e) { return; }
  if (url.origin !== self.location.origin) return; // only our own origin
  // Live data is never cached -- let the API and the push routes reach the
  // network untouched, so a cached account response can never be served.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/v1/')) return;

  /* App-shell navigations: network-first so an online open always gets the
     freshest board (the whole app is one no-store HTML file), falling back to
     the cached shell only when offline. */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        // Only cache a real, same-origin 200 -- never an enforcing board's 302
        // bootstrap redirect or an opaque response.
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('/', copy)).catch(() => {});
        }
        return res;
      } catch (_e) {
        const hit = await caches.match('/');
        return hit || Response.error();
      }
    })());
    return;
  }

  /* The named shell assets change rarely: cache-first, refreshing the copy in
     the background. */
  if (SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    })());
    return;
  }
  // Anything else: default network handling (no respondWith).
});

/* The coordinator's sender (kosmos-relay VapidSender) posts who/what/where and
   never content, so the payload is {kind, agent, project, id, address} -- NOT
   {title, body}. `kind` is one of posted|replied|needs_you; `address` is the
   person's own Mac host ("<mac>.<domain>", no scheme) so a tap opens her board.
   We render a plain-language line from those fields, still preferring an
   explicit title/body if some future producer sends one. */
const KIND_HEADLINE = {
  needs_you: 'needs you',
  posted: 'posted an update',
  replied: 'replied',
};

/* Where notificationclick should land. Prefer an explicit url; else build https
   from the coordinator's `address` (validated as a hostname so a malformed
   value can never become an arbitrary navigation); else the board on this
   origin. */
function boardUrlFor(data) {
  if (typeof data.url === 'string' && data.url) return data.url;
  if (typeof data.address === 'string' && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(data.address)) {
    return 'https://' + data.address + '/';
  }
  return '/';
}

/* Turn a push payload into a notification. Factored out so the shape is in one
   place and defensive about a payload-less push (some pushes carry no data) and
   about a non-JSON body. */
function notificationFor(event) {
  let data = {};
  if (event.data) {
    try { data = event.data.json(); }
    catch (_e) { data = {}; }
  }
  let title = (typeof data.title === 'string' && data.title) ? data.title : '';
  let body = (typeof data.body === 'string' && data.body) ? data.body : '';
  if (!title || !body) {
    const agent = (typeof data.agent === 'string' && data.agent) ? data.agent : 'An agent';
    const headline = KIND_HEADLINE[data.kind] || 'has an update';
    if (!title) title = agent + ' ' + headline;
    if (!body) {
      body = (typeof data.project === 'string' && data.project)
        ? ('In ' + data.project)
        : 'Open Kosmos to see what happened.';
    }
  }
  const options = {
    body: body,
    icon: data.icon || '/icons/kosmos-192.png',
    badge: data.badge || '/icons/kosmos-192.png',
    // Distinct events show as distinct notifications (tag by event id), so a
    // burst of nudges does not silently collapse into one; a constant tag only
    // when there is nothing to key on.
    tag: (typeof data.id === 'string' && data.id) ? ('kosmos-' + data.id) : 'kosmos',
    // Where notificationclick should take the person; her own Mac when known.
    data: { url: boardUrlFor(data) },
  };
  return { title, options };
}

self.addEventListener('push', (event) => {
  const { title, options } = notificationFor(event);
  /* userVisibleOnly:true was promised at subscribe time, so every push MUST
     show a notification or the browser eventually revokes the subscription. */
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Focus an existing board tab if one is open; otherwise open a new one.
    for (const c of all) {
      let same = false;
      try { same = new URL(c.url).origin === self.location.origin; } catch (_e) {}
      if (same && 'focus' in c) {
        if ('navigate' in c) { try { await c.navigate(target); } catch (_e) {} }
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});

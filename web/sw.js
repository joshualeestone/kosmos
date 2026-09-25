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
          // waitUntil so the browser keeps the worker alive until the write
          // lands: respondWith resolves when `res` is returned, and a dangling
          // cache write after that can be cut short when the worker is killed.
          event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.put('/', copy)).catch(() => {}));
        }
        return res;
      } catch (_e) {
        const hit = await caches.match('/');
        return hit || Response.error();
      }
    })());
    return;
  }

  /* The named shell assets (manifest + the two icons) change rarely and are
     dropped wholesale when a new worker version activates, so this is a plain
     cache-first: serve the cached copy when present, otherwise fetch and cache
     it. NOT stale-while-revalidate -- a hit is returned as-is with no background
     revalidation; freshness comes from the version bump busting the cache, not
     from re-fetching on every hit. */
  if (SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        // waitUntil so the worker is not killed before the cache write of this
        // freshly-fetched miss completes (respondWith resolves when `res` returns).
        event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => {}));
      }
      return res;
    })());
    return;
  }
  // Anything else: default network handling (no respondWith).
});

/* The coordinator's sender (kosmos-relay VapidSender) posts who/what/where and
   never content, so the payload is {kind, agent, project, id, address, session} -- NOT
   {title, body}. `kind` is one of posted|replied|needs_you; `address` is the
   person's own Mac host ("<mac>.<domain>", no scheme) so a tap opens her board.
   We render a plain-language line from those fields, still preferring an
   explicit title/body if some future producer sends one. */
const KIND_HEADLINE = {
  needs_you: 'needs you',
  posted: 'posted an update',
  replied: 'replied',
};

/* Where notificationclick should land. Built ONLY from the coordinator's
   `address` (a bare hostname), and only after a strict hostname check, so a
   malformed or hostile value can never become an arbitrary navigation -- a
   `javascript:` URI or a foreign origin -- when notificationclick hands it to
   clients.openWindow()/navigate(). No `url` field is honored: the coordinator
   never sends one, and passing an arbitrary string straight through would be
   exactly that gap. A future producer that wants a full URL must add its own
   validated branch, not a passthrough. Falls back to the board on this origin.

   #718: when the push names the agent (`session`, a plain id the coordinator
   has already checked), the tap opens that agent: the board's own link
   `?tab=detail&agent=<session>`, which it reads at boot. Checked again here
   with the same rule, and put in with URLSearchParams, so it can only ever be
   a query value, never a path, a scheme or another host. Anything else opens
   the board's home, as before. The iOS app builds the same link, but only the
   link's SHAPE is shared: iOS also checks which host it opens (one name under
   the relay domain), and this worker does not yet (kosmos#3689). */
const TAP_SESSION = /^[a-z0-9][a-z0-9_-]{0,63}$/;
function boardUrlFor(data) {
  let url = '/';
  if (typeof data.address === 'string' && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(data.address)) {
    url = 'https://' + data.address + '/';
  }
  if (typeof data.session === 'string' && TAP_SESSION.test(data.session)) {
    url += '?' + new URLSearchParams({ tab: 'detail', agent: data.session }).toString();
  }
  return url;
}

/* Turn a push payload into a notification. Factored out so the shape is in one
   place and defensive about a payload-less push (some pushes carry no data) and
   about a non-JSON body. */
function notificationFor(event) {
  let data = {};
  if (event.data) {
    try { data = event.data.json(); }
    catch (_e) { data = {}; }
    // A push can carry a valid but non-object body (JSON `null`, a number, a
    // bare string), which would make the property reads below throw and lose the
    // notification. The coordinator only ever sends an object, so this is
    // defensive; it costs one line to never drop a push over a shape surprise.
    if (!data || typeof data !== 'object') data = {};
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
    let targetOrigin = null;
    try { targetOrigin = new URL(target, self.location.origin).origin; } catch (_e) {}
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Reuse an open tab ONLY when it is at the target's own origin. WindowClient
    // .navigate() rejects cross-origin, so a tab at a different origin (a
    // federated view, or the board on localhost while the target is the Mac's
    // tunnel host) cannot be sent there by navigating it -- matching against the
    // SW's own origin instead would focus that tab and silently never reach the
    // Mac. Anything else falls through to openWindow, which DOES open
    // cross-origin, so the click-through lands on the Mac whether or not a tab is
    // already open.
    for (const c of all) {
      let cOrigin = null;
      try { cOrigin = new URL(c.url).origin; } catch (_e) {}
      if (cOrigin && cOrigin === targetOrigin && 'focus' in c) {
        // #718: focus the page navigate() LANDED on. A tab this worker does not control (a
        // hard reload bypasses it) rejects navigate(), and an engine without navigate() cannot
        // move the tab at all; focusing it anyway would show the old page, not the agent. So
        // try the next open tab at this origin, and if none can be moved, the link opens in a
        // window of its own (the old page stays where it was).
        let landed = null;
        if ('navigate' in c) { try { landed = await c.navigate(target); } catch (_e) {} }
        if (landed && 'focus' in landed) return landed.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});

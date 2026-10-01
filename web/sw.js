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

/* v2 (#4103): a phone whose offline copy of '/' became the relay's sign-in page drops it on activate (the old cache
   is deleted below) and re-caches the board, now checked, at install. */
/* v3 (#4798): the manifest gained the maskable icons; the manifest is served from this cache, so a phone that
   already had v2 would keep the old manifest until the version changes. */
const SHELL_CACHE = 'kosmos-shell-v3';

/* The shell is the one HTML file (served at /) plus the manifest and the
   install icons the manifest names (the two "any" and, #4798, the two maskable).
   Everything else is live data over the network. */
const SHELL_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/icons/kosmos-192.png',
  '/icons/kosmos-512.png',
  '/icons/kosmos-maskable-192.png',
  '/icons/kosmos-maskable-512.png',
];

/* #4103: only the BOARD may become the offline copy of '/'. A signed-out phone's navigation through the relay comes
   back as the relay's own sign-in page, a same-origin 200, and caching it made the app open offline to that page.
   The board's <head> carries <meta name="kosmos-version"> near its top (the build and install scripts stamp its value); a page without
   it is not the board. Read from a CLONE, and only its first characters (the marker is under 1KB in), so the response
   handed to the page is untouched and a large board is not read twice. A marker inside the page, not a response
   header, because the relay is a separate service and may not pass our headers through. */
const SHELL_MARK = '<meta name="kosmos-version"';
const SHELL_SCAN_CHARS = 16384;   // decoded characters; the marker is ASCII and near the top
async function isBoardShell(res) {
  try {
    const body = res && res.body;
    if (!body || typeof body.getReader !== 'function') return false;
    const reader = body.getReader();
    const dec = new TextDecoder();
    let seen = '';
    while (seen.length < SHELL_SCAN_CHARS) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += dec.decode(value, { stream: true });
      if (seen.slice(0, SHELL_SCAN_CHARS).includes(SHELL_MARK)) break;
    }
    reader.cancel().catch(() => {});
    // Only the scanned prefix counts, however large the chunks the body arrived in.
    return seen.slice(0, SHELL_SCAN_CHARS).includes(SHELL_MARK);
  } catch (_e) { return false; }
}
/* Put a navigation's response into the cache as '/', only when it is the board. `probe` and `copy` are two clones
   taken before the response is handed to the page. */
async function cacheShellIfBoard(probe, copy) {
  if (!(await isBoardShell(probe))) {
    // NOT awaited: in the Streams spec's tee (ReadableStreamDefaultTee), cancelling one branch returns a promise that
    // resolves only when its sibling branch is cancelled too; the sibling here is never cancelled, so awaiting would
    // hold the worker's waitUntil open indefinitely (it hung the unit tests under Node's streams). Fire and let go.
    try { if (copy && copy.body) copy.body.cancel().catch(() => {}); } catch (_e) { /* nothing held */ }
    return false;
  }
  const cache = await caches.open(SHELL_CACHE);
  await cache.put('/', copy);
  return true;
}

self.addEventListener('install', (event) => {
  /* The board is a single long-lived tab; take over as soon as ready rather
     than waiting for every tab to close. */
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // #4103: '/' is fetched and checked like a navigation (a signed-out install must not pre-cache the relay's
    // sign-in page); the manifest and icons are cached as before.
    await cache.addAll(SHELL_ASSETS.filter((a) => a !== '/')).catch(() => {});
    const res = await fetch('/');
    if (res && res.ok && res.type === 'basic' && !res.redirected) await cacheShellIfBoard(res.clone(), res.clone());
  })()
    // A cold install with no network must still install: the fetch handler
    // falls back to the network, so a failed pre-cache is not fatal.
    .catch(() => {}));
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
        // bootstrap redirect or an opaque response -- and only when it is the
        // board itself, not the relay's sign-in page (#4103).
        // Not a redirected one either: a cached redirected response served to a navigation is a network error.
        if (res && res.ok && res.type === 'basic' && !res.redirected) {
          const probe = res.clone();
          const copy = res.clone();
          // waitUntil so the browser keeps the worker alive until the write
          // lands: respondWith resolves when `res` is returned, and a dangling
          // cache write after that can be cut short when the worker is killed.
          event.waitUntil(cacheShellIfBoard(probe, copy).catch(() => {}));
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
  /* '/' is NOT served from here (#4103, review round 1): only a navigation may put '/' in the cache, and only after
     the board check above. A non-navigation GET of '/' (a script's fetch, a prefetch) goes to the network untouched,
     so a signed-out one can never write the relay's sign-in page as the offline copy. This branch serves the
     manifest and the two icons. */
  if (url.pathname !== '/' && SHELL_ASSETS.includes(url.pathname)) {
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
   the board's home, as before. NOTE: a phone's web push is subscribed on the
   coordinator's origin, so the COORDINATOR's worker (kosmos-relay
   coordinator/src/sw.js) handles that tap, with the same link and rule. This
   worker sees a push only from a subscription made on the board's own origin,
   of which there is none today (#3510). The iOS app builds the same link.

   #3689: a domain SHAPE is not enough for the host. `address` must be exactly one
   host label under this board's own relay domain (this worker runs on
   "<mac>.<domain>", so "<other-mac>.<domain>" is accepted and "evil.example" is
   not). On the Kosmos relay domain that keeps a tap on Kosmos-owned hosts; it
   does NOT prove the host is one of THIS person's Macs (another person's Mac, or
   a service host such as login.<domain>, has the same shape), which only the
   coordinator knows. KNOWN LIMIT: the domain is whatever this board is served
   under, which the worker cannot check against the coordinator; a board served on
   a shared domain (a tunnel service such as *.trycloudflare.com, or a public
   suffix such as example.co.uk) would accept any other name there. The label
   rule is the iOS app's (PushBridge.isHostLabel: RFC 1123, no punycode, since xn--
   is how a lookalike Unicode name arrives in ASCII). Two differences from iOS: the
   domain here comes from this worker's own host, not the coordinator's, and the
   coordinator host is not excluded (the board does not know it). A board on
   localhost, an IP address, a two-label host, or a name written with a trailing
   dot has no relay domain, so every tap opens the board on this origin. Non-ASCII
   is refused before lowercasing, as iOS does (JS lowercases some non-ASCII
   letters, such as the Kelvin sign, into ASCII ones). The host is decided FIRST; the session query is
   added after, to whichever base that leaves. */
const TAP_SESSION = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function relayDomainOf(host) {
  const labels = String(host || '').toLowerCase().split('.');
  if (labels.length < 3 || labels.some((l) => !l)) return '';
  if (labels.every((l) => /^[0-9]+$/.test(l))) return ''; // an IPv4 address
  return labels.slice(1).join('.');
}

function isHostLabel(label) {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label) && label.slice(0, 4) !== 'xn--';
}

// The Mac host a tap may open, lowercased, or '' when `address` is not one.
function macHostFor(address) {
  if (typeof address !== 'string' || !/^[\x00-\x7f]*$/.test(address)) return '';
  const host = address.toLowerCase();
  const domain = relayDomainOf(self.location && self.location.hostname);
  if (!domain || !host.endsWith('.' + domain)) return '';
  return isHostLabel(host.slice(0, host.length - domain.length - 1)) ? host : '';
}

function boardUrlFor(data) {
  const host = macHostFor(data.address);
  let url = host ? 'https://' + host + '/' : '/';
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
        // navigate() RESOLVES null when the tab moved but landed on another origin (a sign-in
        // redirect in front of the Mac): it did move, so focus it rather than open a second.
        let landed; let moved = false;
        if ('navigate' in c) { try { landed = await c.navigate(target); moved = true; } catch (_e) {} }
        if (moved && landed && 'focus' in landed) return landed.focus();
        if (moved) return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});

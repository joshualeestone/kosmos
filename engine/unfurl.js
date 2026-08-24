'use strict';
/**
 * A link's preview: the page's title, description and image, read from its
 * Open Graph tags (#357).
 *
 * 🔑 THE BOARD FETCHES, AND THE BROWSER NEVER TOUCHES THE SITE (Josh,
 * 2026-08-23 12:05: "the board can fetch it, don't leak IPs"). The page is
 * read here, once, and its image is served back through `image()` rather
 * than as the site's own URL, so a preview drawn in the room makes exactly
 * one party talk to the site: this process, from this Mac, at the moment the
 * message is drawn. Nothing is fetched when a link is pasted; only when a
 * message carrying it is rendered and the page asks.
 *
 * 🛑 AN ARBITRARY URL IS AN ARBITRARY NETWORK CALL FROM THE PERSON'S MACHINE,
 * and an agent can post one. So the target is gated BEFORE any byte moves:
 * http and https only; no loopback, link-local, private or multicast address,
 * by name or by number, including the host every redirect lands on; at most
 * three redirects; at most 512 KB of page and 5 MB of image; five seconds
 * each. A refusal is a sentence, never a throw, and a page with no tags is
 * "nothing to show", not an error: the link stays a link.
 *
 * ⚠️ NAMES ARE RESOLVED HERE, NOT TRUSTED. `localhost.example.com` could
 * resolve to 127.0.0.1; so every hostname is looked up and every address it
 * resolves to is checked, and the fetch is made to the name only after all
 * of them pass. A DNS answer that changes between the check and the fetch
 * (rebinding) is the residual risk, and it is named rather than pretended
 * away: the caps above bound what such a fetch could read.
 */
const dns = require('node:dns').promises;
const net = require('node:net');

const PAGE_MAX = 512 * 1024;
const IMAGE_MAX = 5 * 1024 * 1024;
const TIMEOUT_MS = 5000;
const REDIRECTS = 3;
const CACHE_MS = 10 * 60 * 1000;
const REFUSAL_MS = 60 * 1000;          // a blip is not a ten-minute verdict
const CACHE_MAX = 200;
const IMAGE_CACHE_BYTES = 32 * 1024 * 1024;   // images are bytes; budget them, not count them

/* Test seams, same shape as the rest of the engine: what fetches, and what
   resolves names. Both default to the real thing. */
let fetcher = (url, opts) => fetch(url, opts);
let resolver = (host) => dns.lookup(host, { all: true });
function setFetcher(fn) { fetcher = typeof fn === 'function' ? fn : ((url, opts) => fetch(url, opts)); }
function setResolver(fn) { resolver = typeof fn === 'function' ? fn : ((host) => dns.lookup(host, { all: true })); }

const cache = new Map();
let imageBytes = 0;
function sizeOf(value) { return value && value.ok && value.bytes ? value.bytes.length : 0; }
function drop(key) {
  const hit = cache.get(key);
  if (!hit) return;
  imageBytes -= sizeOf(hit.value);
  cache.delete(key);
}
function cached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  /* A refusal or a transient failure is remembered for a minute, an answer
     for ten: "took too long" should not pin a link for every room that
     shows it. */
  const ttl = hit.value && hit.value.ok ? CACHE_MS : REFUSAL_MS;
  if (Date.now() - hit.at > ttl) { drop(key); return null; }
  return hit.value;
}
function remember(key, value) {
  drop(key);
  while (cache.size >= CACHE_MAX) drop(cache.keys().next().value);
  imageBytes += sizeOf(value);
  /* Images are bytes: evict oldest until the budget holds, so two hundred
     five-megabyte images cannot sit in memory for ten minutes. */
  while (imageBytes > IMAGE_CACHE_BYTES && cache.size) {
    const oldest = cache.keys().next().value;
    if (oldest === key) break;
    drop(oldest);
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}
function resetForTests() { cache.clear(); imageBytes = 0; fetcher = (url, opts) => fetch(url, opts); resolver = (host) => dns.lookup(host, { all: true }); }

/** Is this address one that must never be fetched from here? */
function privateAddress(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;   // carrier NAT, still not the internet
    if (p[0] >= 224) return true;                                  // multicast and reserved
    return false;
  }
  if (kind === 6) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return true;
    if (/^fe[89ab]/.test(low)) return true;                      // link-local
    if (/^fe[cdef]/.test(low)) return true;                      // site-local, deprecated and still routed
    if (low.startsWith('fc') || low.startsWith('fd')) return true;   // unique local
    if (low.startsWith('ff')) return true;                          // multicast
    /* Forms that carry an IPv4 address inside: mapped (::ffff:a.b.c.d or
       ::ffff:xxxx:xxxx), NAT64 (64:ff9b::a.b.c.d), 6to4 (2002:xxxx:xxxx::),
       and the old IPv4-compatible (::a.b.c.d). Each is judged by the v4
       address it carries. */
    const v4 = embeddedV4(low);
    if (v4 !== null) return privateAddress(v4);
    return false;
  }
  return true;   // not an address at all: refuse, never guess
}

/** The IPv4 address an IPv6 form carries, dotted, or null when it is a plain
    v6 address. The URL parser hands us the compressed hex form, so the last
    32 bits are read back out of the hextets. */
function embeddedV4(low) {
  const dotted = low.match(/^(?:::ffff:|64:ff9b::|::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const lastTwo = (hex) => {
    const parts = hex.split(':').filter(Boolean);
    if (parts.length < 2) return null;
    const a = parseInt(parts[parts.length - 2], 16); const b = parseInt(parts[parts.length - 1], 16);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return [a >> 8, a & 255, b >> 8, b & 255].join('.');
  };
  if (/^::ffff:[0-9a-f]+:[0-9a-f]+$/.test(low) || /^64:ff9b::[0-9a-f]+:[0-9a-f]+$/.test(low)) return lastTwo(low);
  if (/^2002:[0-9a-f]+:[0-9a-f]+(:|$)/.test(low)) {
    const parts = low.split(':');
    const a = parseInt(parts[1], 16); const b = parseInt(parts[2], 16);
    return [a >> 8, a & 255, b >> 8, b & 255].join('.');
  }
  if (/^::[0-9a-f]+:[0-9a-f]+$/.test(low) && !low.startsWith('::ffff')) return lastTwo(low);   // IPv4-compatible, deprecated
  return null;
}

/**
 * The one gate. Returns { ok: true, url } for a URL this process may fetch,
 * or { ok: false, because } in words.
 */
async function allowed(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return { ok: false, because: 'that is not a web address' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, because: 'only http and https links get a preview' };
  if (u.username || u.password) return { ok: false, because: 'a link carrying a sign-in is not fetched' };
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');   // a trailing dot is the same name
  if (!host) return { ok: false, because: 'that link has no host' };
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, because: 'links to this computer or this network are not fetched' };
  }
  if (net.isIP(host)) {
    if (privateAddress(host)) return { ok: false, because: 'links to this computer or this network are not fetched' };
    return { ok: true, url: u.toString() };
  }
  let addrs;
  try { addrs = await resolver(host); } catch { return { ok: false, because: 'that site could not be found' }; }
  const list = Array.isArray(addrs) ? addrs : [addrs];
  if (!list.length) return { ok: false, because: 'that site could not be found' };
  for (const a of list) {
    const ip = a && typeof a === 'object' ? a.address : a;
    if (privateAddress(String(ip))) return { ok: false, because: 'links to this computer or this network are not fetched' };
  }
  return { ok: true, url: u.toString() };
}

/** Read a response body up to `max` bytes. `keepHead` true returns the first
    `max` bytes of a longer body (a page's tags live in its head, and most
    media-heavy pages are past the cap); false returns null for a longer body
    (an image is whole or nothing). The rest of the body is cancelled either
    way, so the socket goes back to the pool. */
async function readCapped(res, max, keepHead) {
  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length <= max) return buf;
    return keepHead ? buf.subarray(0, max) : null;
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    chunks.push(Buffer.from(value));
    if (total > max) {
      try { await reader.cancel(); } catch { /* done with it either way */ }
      return keepHead ? Buffer.concat(chunks).subarray(0, max) : null;
    }
  }
  return Buffer.concat(chunks);
}

/** Let go of a body this code is not going to read, so the connection is
    not held until garbage collection. Never throws. */
function discard(res) {
  try { if (res && res.body && typeof res.body.cancel === 'function') res.body.cancel().catch(() => {}); } catch { /* nothing held */ }
}

/**
 * Fetch with the gate applied to the first URL and to every redirect.
 * Returns { ok, res, url } or { ok: false, because }.
 */
async function guardedFetch(raw, accept) {
  let url = raw;
  for (let hop = 0; hop <= REDIRECTS; hop += 1) {
    const gate = await allowed(url);
    if (!gate.ok) return gate;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetcher(gate.url, {
        redirect: 'manual',
        signal: ctl.signal,
        headers: { accept, 'user-agent': 'Kosmos link preview' },
      });
    } catch (err) {
      clearTimeout(timer);
      return { ok: false, because: err && err.name === 'AbortError' ? 'that site took too long to answer' : 'that site could not be reached' };
    }
    if (res.status >= 300 && res.status < 400) {
      clearTimeout(timer);
      discard(res);
      const to = res.headers.get('location');
      if (!to) return { ok: false, because: 'that site sent us nowhere' };
      try { url = new URL(to, gate.url).toString(); } catch { return { ok: false, because: 'that site sent us somewhere we cannot read' }; }
      continue;
    }
    if (!res.ok) { clearTimeout(timer); discard(res); return { ok: false, because: 'that site answered ' + res.status }; }
    return { ok: true, res, url: gate.url, timer };
  }
  return { ok: false, because: 'that site redirected too many times' };
}

/** Pull the tags out of an HTML head. Exported for the tests. */
function parseTags(html) {
  const head = String(html).slice(0, PAGE_MAX).replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, '');
  const meta = {};
  const re = /<meta\s+[^>]*>/gi;
  let m;
  while ((m = re.exec(head))) {
    const tag = m[0];
    const attr = (name) => {
      const m2 = tag.match(new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i'));
      return m2 ? (m2[1] !== undefined ? m2[1] : m2[2]) : undefined;
    };
    const prop = attr('property') || attr('name');
    const content = attr('content');
    if (!prop || content === undefined) continue;
    const key = prop.toLowerCase();
    if (!(key in meta)) meta[key] = decodeEntities(content);
  }
  const titleTag = (head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const title = meta['og:title'] || meta['twitter:title'] || (titleTag ? decodeEntities(titleTag.replace(/\s+/g, ' ').trim()) : '');
  const description = meta['og:description'] || meta['twitter:description'] || meta.description || '';
  const image = meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || '';
  const site = meta['og:site_name'] || '';
  return { title: title.slice(0, 300), description: description.slice(0, 500), image: image.slice(0, 2000), site: site.slice(0, 100) };
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ');
}

/**
 * The preview for a URL: { ok: true, url, title, description, image, site }
 * where `image` is the site's image URL (the ROUTE turns it into a proxied
 * one; this module does not know its own route), or { ok: false, because }.
 * "No tags" is ok:false with because 'nothing to show', which the page
 * treats as "leave the link a link".
 */
async function preview(raw) {
  const key = 'p:' + String(raw);
  const hit = cached(key);
  if (hit) return hit;
  const got = await guardedFetch(raw, 'text/html,application/xhtml+xml');
  if (!got.ok) return remember(key, got);
  try {
    const type = (got.res.headers.get('content-type') || '').toLowerCase();
    if (!type.includes('html')) { discard(got.res); return remember(key, { ok: false, because: 'that link is not a page' }); }
    const body = await readCapped(got.res, PAGE_MAX, true);
    const tags = parseTags(body ? body.toString('utf8') : '');
    if (!tags.title && !tags.image) return remember(key, { ok: false, because: 'nothing to show' });
    let image = '';
    if (tags.image) {
      try { image = new URL(tags.image, got.url).toString(); } catch { image = ''; }
      if (image && !/^https?:/.test(image)) image = '';
    }
    return remember(key, { ok: true, url: got.url, title: tags.title, description: tags.description, image, site: tags.site, fetchedAt: new Date().toISOString() });
  } catch {
    return remember(key, { ok: false, because: 'we could not read that page' });
  } finally {
    clearTimeout(got.timer);
  }
}

/**
 * The image behind a preview, fetched through the same gate, capped, and
 * handed back as bytes with its type: { ok: true, type, bytes } or
 * { ok: false, because }. Only image types come back; anything else is
 * refused so this can never be used to proxy a page.
 */
async function image(raw) {
  const key = 'i:' + String(raw);
  const hit = cached(key);
  if (hit) return hit;
  const got = await guardedFetch(raw, 'image/*');
  if (!got.ok) return remember(key, got);
  try {
    const type = (got.res.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
    /* 🛑 NO SVG. An SVG carries script, and this proxy serves it on the
       board's own origin, where the write routes live with no login: "open
       image in new tab" on a hostile og:image would run that script as the
       board. Raster types only; the route adds a sandboxing CSP as well. */
    if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(type)) { discard(got.res); return remember(key, { ok: false, because: 'that is not an image this board will show' }); }
    const bytes = await readCapped(got.res, IMAGE_MAX, false);
    if (!bytes) return remember(key, { ok: false, because: 'that image is too large to show' });
    return remember(key, { ok: true, type, bytes });
  } catch {
    return remember(key, { ok: false, because: 'we could not read that image' });
  } finally {
    clearTimeout(got.timer);
  }
}

/**
 * The page behind a URL as plain words, for the AI-policy ingest (#479).
 * Same gate, caps, timeout and redirect rules as preview -- and the same
 * privacy shape: the BOARD fetches, so no agent's or reader's traffic ever
 * touches the company's site. HTML is stripped to its words; plain text
 * passes as-is; anything else is refused with a sentence. Uncached: a
 * policy fetch is a deliberate act, not a hover.
 */
async function pageText(raw) {
  const got = await guardedFetch(raw, 'text/html,application/xhtml+xml,text/plain');
  if (!got.ok) return got;
  try {
    const type = (got.res.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
    if (type && !type.includes('html') && type !== 'text/plain') {
      discard(got.res);
      return { ok: false, because: 'that link is not a page of words we can read' };
    }
    const body = await readCapped(got.res, PAGE_MAX, true);
    const s = body ? body.toString('utf8') : '';
    const text = type.includes('html')
      ? decodeEntities(
        s.replace(/<!--[\s\S]*?-->/g, ' ')
          .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
          .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, '\n')
          .replace(/<[^>]+>/g, ' '),
      ).replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
      : s.trim();
    if (!text) return { ok: false, because: 'that page had no words we could read' };
    return { ok: true, text, url: got.url };
  } catch {
    return { ok: false, because: 'we could not read that page' };
  } finally {
    clearTimeout(got.timer);
  }
}

/** The first http(s) link in a message's text, or null. Exported for the
    payload helper and its test. */
const LINK_RE = /https?:\/\/[^\s<>"')\]]+/i;
function firstLink(text) {
  const m = String(text || '').match(LINK_RE);
  if (!m) return null;
  return m[0].replace(/[.,;:!?]+$/, '');
}

/** What the cache holds for a URL right now, without fetching: the preview
    ({ ok: true, ... }), a refusal ({ ok: false }), or null for never asked.
    The payload helper reads this synchronously while serving a poll. */
function peek(raw) {
  return cached('p:' + String(raw));
}

/* In flight, so a poll every five seconds does not start a second fetch for
   a link whose first is still running. */
const inflight = new Set();
/** Start a fetch for a URL if nothing is cached or running; never awaited. */
function warm(raw) {
  const key = String(raw);
  if (cached('p:' + key) || inflight.has(key)) return;
  inflight.add(key);
  preview(key).catch(() => {}).finally(() => inflight.delete(key));
}

module.exports = { firstLink, peek, warm, preview, image, pageText, allowed, privateAddress, parseTags, setFetcher, setResolver, resetForTests, PAGE_MAX, IMAGE_MAX, REDIRECTS };

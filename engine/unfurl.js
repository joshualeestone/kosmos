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
const CACHE_MAX = 200;

/* Test seams, same shape as the rest of the engine: what fetches, and what
   resolves names. Both default to the real thing. */
let fetcher = (url, opts) => fetch(url, opts);
let resolver = (host) => dns.lookup(host, { all: true });
function setFetcher(fn) { fetcher = typeof fn === 'function' ? fn : ((url, opts) => fetch(url, opts)); }
function setResolver(fn) { resolver = typeof fn === 'function' ? fn : ((host) => dns.lookup(host, { all: true })); }

const cache = new Map();
function cached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_MS) { cache.delete(key); return null; }
  return hit.value;
}
function remember(key, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
  return value;
}
function resetForTests() { cache.clear(); fetcher = (url, opts) => fetch(url, opts); resolver = (host) => dns.lookup(host, { all: true }); }

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
    if (low.startsWith('fe8') || low.startsWith('fe9') || low.startsWith('fea') || low.startsWith('feb')) return true; // link-local
    if (low.startsWith('fc') || low.startsWith('fd')) return true;   // unique local
    if (low.startsWith('ff')) return true;                          // multicast
    if (low.startsWith('::ffff:')) return privateAddress(low.slice(7)); // mapped v4
    return false;
  }
  return true;   // not an address at all: refuse, never guess
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
  const host = u.hostname.replace(/^\[|\]$/g, '');
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

/** Read at most `max` bytes of a response body; null if it is larger. */
async function readCapped(res, max) {
  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > max ? null : buf;
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { try { await reader.cancel(); } catch { /* done with it either way */ } return null; }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
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
      const to = res.headers.get('location');
      if (!to) return { ok: false, because: 'that site sent us nowhere' };
      try { url = new URL(to, gate.url).toString(); } catch { return { ok: false, because: 'that site sent us somewhere we cannot read' }; }
      continue;
    }
    if (!res.ok) { clearTimeout(timer); return { ok: false, because: 'that site answered ' + res.status }; }
    return { ok: true, res, url: gate.url, timer };
  }
  return { ok: false, because: 'that site redirected too many times' };
}

/** Pull the tags out of an HTML head. Exported for the tests. */
function parseTags(html) {
  const head = String(html).slice(0, PAGE_MAX);
  const meta = {};
  const re = /<meta\s+[^>]*>/gi;
  let m;
  while ((m = re.exec(head))) {
    const tag = m[0];
    const prop = (tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const content = (tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1];
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
    if (!type.includes('html')) return remember(key, { ok: false, because: 'that link is not a page' });
    const body = await readCapped(got.res, PAGE_MAX);
    const tags = parseTags(body ? body.toString('utf8') : '');
    if (!tags.title && !tags.image) return remember(key, { ok: false, because: 'nothing to show' });
    let image = '';
    if (tags.image) {
      try { image = new URL(tags.image, got.url).toString(); } catch { image = ''; }
      if (image && !/^https?:/.test(image)) image = '';
    }
    return remember(key, { ok: true, url: got.url, title: tags.title, description: tags.description, image, site: tags.site });
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
    if (!/^image\/(png|jpeg|gif|webp|avif|svg\+xml)$/.test(type)) return remember(key, { ok: false, because: 'that is not an image' });
    const bytes = await readCapped(got.res, IMAGE_MAX);
    if (!bytes) return remember(key, { ok: false, because: 'that image is too large to show' });
    return remember(key, { ok: true, type, bytes });
  } catch {
    return remember(key, { ok: false, because: 'we could not read that image' });
  } finally {
    clearTimeout(got.timer);
  }
}

module.exports = { preview, image, allowed, privateAddress, parseTags, setFetcher, setResolver, resetForTests, PAGE_MAX, IMAGE_MAX, REDIRECTS };

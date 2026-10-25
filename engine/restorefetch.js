'use strict';
/**
 * kosmos#5536 (E0.7, restore) slice 2: the stored objects of ONE recorded manifest, fetched through read grants
 * (kosmos#5686 c, kosmos-relay docs/coordinator-api.md "Reading a member's backup"). This is restorerun.js's
 * fetchObject, and its plan hook.
 *
 * The grant itself is injected (grant(body)), so who authorises it stays out of here: a reviewer's session today
 * (#5686 c), the destination's grant riding on a released restore request later (#5536 r4). Both answer
 *   { member, epoch, expires_at, manifest: { key, sha256, size, url }, objects: [{ key, url }] }
 * with one presigned GET per key, usable for 5 minutes.
 *
 * Why it batches: the route allows READ_GRANT_CALLS (40) calls an hour and 500 keys a call, and backuprestore asks for
 * chunks one at a time. So runRestore hands plan() every object key the opened manifest names, and a chunk's first
 * fetch grants its whole batch of 500. A URL near its expiry, or one S3 answers as expired, is granted again for its
 * batch, never per chunk. A refused grant (a 429 included) stops every later fetch with its reason (planned().because).
 *
 * Nothing it is handed is trusted for content: every answer must echo the request (member, epoch, the manifest's key,
 * the recorded sha256 and size) and name only keys that were asked for, every URL must be https and is never
 * redirected, and every body is cut off at maxBytes. runRestore and backuprestore then check every byte against the
 * device-signed manifest, so a wrong URL reads as a failure, never as the member's data.
 *
 * Not here, and refused by name instead (#5536 comment 6404447686): a chunk under another key epoch. backupsnapshot.js
 * keeps an indexed chunk's epoch on purpose, the route grants only the request's epoch, and runRestore opens with one
 * member key, so a snapshot taken after a rotation inside its week names chunks this restore cannot read yet.
 */

const GRANT_KEYS = 500;   // the route's most keys in one call
const EXPIRY_MARGIN_MS = 30000;   // a URL this close to expires_at is granted again before it is used
const GET_TIMEOUT_MS = 120000;   // one object (restorerun's FETCH_TIMEOUT_MS)
const HEX64_RE = /^[0-9a-f]{64}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const ANOTHER_EPOCH = 'this backup names files sealed under another key of this member, which restore cannot read yet';

/* Why a key cannot be granted for this manifest, or null: the route's own rule, <org>/<member>/<epoch>/<period>/<64 hex>.
   A key that differs ONLY in its epoch gets its own sentence (the module header's rotation case). */
function keyProblem(key, { org, member, epoch, period }) {
  const parts = typeof key === 'string' ? key.split('/') : [];
  if (parts.length !== 5 || parts[0] !== org || parts[1] !== member || parts[3] !== period || !HEX64_RE.test(parts[4])) {
    return 'this backup names a file Kosmos+ could not have stored';
  }
  if (parts[2] !== epoch) return /^[1-9][0-9]{0,17}$/.test(parts[2]) ? ANOTHER_EPOCH : 'this backup names a file Kosmos+ could not have stored';
  return null;
}

/* An https URL as given, or null: nothing else is fetched. */
function httpsUrl(u) {
  if (typeof u !== 'string' || u.length > 8192) return null;
  try { return new URL(u).protocol === 'https:' ? u : null; } catch { return null; }
}

/* Why a grant answer cannot be used for this request, or null. */
function answerProblem(a, req, rec) {
  if (!a || typeof a !== 'object') return 'Kosmos+ answered the read grant with nothing usable';
  if (a.member !== req.member || String(a.epoch) !== req.epoch) return 'Kosmos+ answered the read grant for another member or key';
  const m = a.manifest;
  if (!m || m.key !== rec.key || m.sha256 !== rec.sha256 || (Number.isSafeInteger(rec.size) && m.size !== rec.size)) {
    return 'Kosmos+ answered the read grant for another backup';
  }
  if (!httpsUrl(m.url)) return 'Kosmos+ answered the read grant with an address restore will not use';
  if (!Number.isSafeInteger(a.expires_at)) return 'Kosmos+ answered the read grant with no expiry';
  if (!Array.isArray(a.objects) || a.objects.length !== req.keys.length) return 'Kosmos+ answered the read grant for other files than were asked';
  const asked = new Set(req.keys);
  const seen = new Set();
  for (const o of a.objects) {
    if (!o || !asked.has(o.key) || seen.has(o.key) || !httpsUrl(o.url)) return 'Kosmos+ answered the read grant for other files than were asked';
    seen.add(o.key);
  }
  return null;
}

/* One GET, never thrown: { kind: 'bytes', bytes } | { kind: 'expired' } | { kind: 'missing' }. A redirect is not
   followed, a body past maxBytes is cut off (and is missing), and the read is aborted after timeoutMs. */
async function getOne(fetchFn, url, maxBytes, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetchFn(url, { method: 'GET', redirect: 'manual', signal: ac.signal });
    if (r.status !== 200) {
      let text = '';
      if (r.status === 403) { try { text = (await readCapped(r, 8192)).toString('utf8'); } catch { /* the code is optional */ } }
      else { try { await r.body?.cancel(); } catch { /* nothing to read */ } }
      // Only S3's presigned-url expiry, as engine/backupupload.js reads it for a PUT.
      if (r.status === 403 && /<Code>AccessDenied<\/Code>/.test(text) && /Request has expired/.test(text)) return { kind: 'expired' };
      return { kind: 'missing' };
    }
    const len = Number(r.headers && typeof r.headers.get === 'function' ? r.headers.get('content-length') : NaN);
    if (Number.isFinite(len) && len > maxBytes) { try { await r.body?.cancel(); } catch { /* not read */ } return { kind: 'missing' }; }
    const bytes = await readCapped(r, maxBytes);
    return bytes ? { kind: 'bytes', bytes } : { kind: 'missing' };
  } catch {
    return { kind: 'missing' };
  } finally {
    clearTimeout(t);
  }
}

/* The body as bytes, or null when it runs past max (the rest is not read). */
async function readCapped(r, max) {
  if (!r.body || typeof r.body.getReader !== 'function') {
    const b = Buffer.from(new Uint8Array(await r.arrayBuffer()));
    return b.length > max ? null : b;
  }
  const reader = r.body.getReader();
  const parts = [];
  let n = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > max) return null;
      parts.push(Buffer.from(value));
    }
  } finally {
    try { await reader.cancel(); } catch { /* already done */ }
  }
  return Buffer.concat(parts);
}

/* The fetcher for one recorded manifest. opts:
     grant(body) -> { ok: true, answer } | { ok: false, because, retryAfterSecs? }
                       body is the route's { member, epoch, manifest, keys }; the caller makes the call
     org, member, epoch   as the release names them (epoch as runRestore takes it)
     manifest             the coordinator's record: { key, period, sha256, size }
     fetch, now           globalThis.fetch and Date.now unless given; getTimeoutMs per GET (default 2 min)
   Returns { fetchObject(key, { maxBytes }) -> Buffer | null, plan(keys) -> { ok, because?, unreadable }, planned() }.
   Never throws on what a grant or a store hands it. */
function readGrantFetcher(opts) {
  const grant = opts.grant;
  const fetchFn = opts.fetch || globalThis.fetch;
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const timeoutMs = Number.isSafeInteger(opts.getTimeoutMs) && opts.getTimeoutMs > 0 ? opts.getTimeoutMs : GET_TIMEOUT_MS;
  const rec = opts.manifest || {};
  const ctx = { org: opts.org, member: opts.member, epoch: String(opts.epoch), period: rec.period };
  const urls = new Map();   // key -> { url, expiresAtMs }
  const batchOf = new Map();   // key -> batch index
  const batches = [[]];   // batch 0 is the manifest alone (keys: [])
  const inFlight = new Map();   // batch index -> promise
  let stopped = null;   // the reason every later fetch is refused
  const unreadable = new Map();   // key -> why it is not granted

  const fresh = (key) => { const u = urls.get(key); return u && now() < u.expiresAtMs - EXPIRY_MARGIN_MS ? u.url : null; };

  async function grantBatch(i) {
    if (stopped) return;
    if (inFlight.has(i)) return inFlight.get(i);
    const p = (async () => {
      if (typeof grant !== 'function') { stopped = 'restore has no way to ask Kosmos+ for its files'; return; }
      const body = { member: ctx.member, epoch: Number(ctx.epoch), manifest: rec.key, keys: batches[i].slice() };
      let g;
      try { g = await grant(body); } catch { g = null; }
      if (!g || g.ok !== true) {
        const wait = g && Number.isSafeInteger(g.retryAfterSecs) && g.retryAfterSecs > 0 ? ` (try again in ${Math.ceil(g.retryAfterSecs / 60)} min)` : '';
        stopped = `${(g && typeof g.because === 'string' && g.because) || 'Kosmos+ refused to grant this backup\'s files'}${wait}`;
        return;
      }
      const why = answerProblem(g.answer, { member: ctx.member, epoch: ctx.epoch, keys: body.keys }, rec);
      if (why) { stopped = why; return; }
      const expiresAtMs = g.answer.expires_at * 1000;
      urls.set(rec.key, { url: g.answer.manifest.url, expiresAtMs });
      for (const o of g.answer.objects) urls.set(o.key, { url: o.url, expiresAtMs });
    })();
    inFlight.set(i, p);
    try { await p; } finally { inFlight.delete(i); }
  }

  /* The object keys the opened manifest names, in the order they will be fetched. */
  function plan(keys) {
    const list = Array.isArray(keys) ? keys : [];
    for (const key of list) {
      if (key === rec.key || batchOf.has(key) || unreadable.has(key)) continue;
      const why = keyProblem(key, ctx);
      if (why) { unreadable.set(key, why); continue; }
      let last = batches.length - 1;
      if (last === 0 || batches[last].length >= GRANT_KEYS) { batches.push([]); last += 1; }
      batches[last].push(key);
      batchOf.set(key, last);
    }
    return planned();
  }

  function planned() {
    const why = unreadable.size ? [...new Set(unreadable.values())] : [];
    return { ok: !stopped, because: stopped || undefined, unreadable: [...unreadable.keys()], unreadableBecause: why };
  }

  async function fetchObject(key, o) {
    const maxBytes = o && Number.isSafeInteger(o.maxBytes) && o.maxBytes >= 0 ? o.maxBytes : 0;
    if (typeof fetchFn !== 'function') return null;
    let i;
    if (key === rec.key) i = 0;
    else if (batchOf.has(key)) i = batchOf.get(key);
    else return null;   // not planned, or unreadable (planned() says why)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!fresh(key)) await grantBatch(i);
      const url = fresh(key);
      if (!url) return null;
      const got = await getOne(fetchFn, url, maxBytes, timeoutMs);
      if (got.kind === 'bytes') return got.bytes;
      if (got.kind !== 'expired') return null;
      urls.delete(key);   // S3 says it lapsed (a fast local clock): grant its batch once more
    }
    return null;
  }

  return { fetchObject, plan, planned };
}

module.exports = { readGrantFetcher, keyProblem, GRANT_KEYS, EXPIRY_MARGIN_MS, ANOTHER_EPOCH };

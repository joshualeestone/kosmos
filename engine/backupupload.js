'use strict';
/* #5535 E0.6, the Mac half of the upload: sealed chunk objects (engine/backupformat.js sealNamedChunk) go to the
 * org's bucket through grants the coordinator signs. Coordinator slice 2's shape (kosmos-relay putgrant-5535,
 * coordinator/src/backup.rs GrantReq / GrantResp / PutUpload):
 *
 *   POST /v1/org/backup/grant  { chunks: [{ size, md5 }], nonce }   (signed by this Mac: remote.macRequest)
 *   -> { epoch, period, retain_until, expires_at, uploads: [{ key, url, headers }] }, one upload per chunk, in order.
 *      expires_at and retain_until are ISO-8601 UTC strings ("2026-10-08T18:15:00Z").
 *
 * Each upload is a presigned PUT. Its query signature covers content-length, content-md5, host, if-none-match and
 * the lock headers; `headers` lists exactly what to send (Content-Length and Host are the HTTP client's, so they are
 * NOT in it). Measured on #5535: a matching body 200, a different body 400 BadDigest, a dropped signed header 403, a
 * second PUT 412. Keys are random per upload (two new ids), and each url's path ends with its key.
 *
 * What this module owns, and what it does not:
 *  - Before a single byte leaves, every grant must bind OUR bytes: the MD5 in its headers is the one we asked for, a
 *    Content-Length (if listed) is the chunk's length, X-Amz-SignedHeaders covers content-length, content-md5, host
 *    and if-none-match, If-None-Match is `*`, the url is https and carries the upload's own key, and no url or key
 *    repeats. A coordinator bug cannot make the Mac write something other than what it sealed.
 *  - 412 counts as stored only on a RETRY of that key (an earlier attempt was sent and its answer was lost). The key
 *    is random and only this grant's url, whose signature fixes our MD5, can write it, so whatever holds it is our
 *    bytes. (The uploader holds no read grant, so it cannot check the object's ETag as the coordinator's doc
 *    suggests; the url-to-key binding above is what makes the 412 rule sound instead.) A 412 on the FIRST attempt
 *    means the key was not ours to write: refused.
 *  - Bucket or network trouble (a lost answer, 5xx or SlowDown, 409 a write still in flight) is retried on the SAME
 *    url until the grant expires, never with a new grant (Ice Cream Kitty, from S3's docs): a landed write shows up
 *    as that 412 rather than as a second copy, and a chunk that met only such trouble until expiry ends the run
 *    retryLater. Only a chunk the grant ran out on cleanly (a big batch, or a 403 that says expired) gets a new grant
 *    under a new key, at most MAX_REGRANTS more per batch.
 *  - Every grant must also set the lock the plan says (COMPLIANCE, 29 to 39 days from the grant's own start), may ask
 *    for no header outside the four it is allowed (plus Content-Length), and none twice or with an unprintable
 *    value: on a bucket nobody can delete from, a wrong lock or a malformed request is not recoverable.
 *  - It never retries a grant request as-is: each request carries a fresh nonce, and each new grant spends the
 *    member's allowance again (Kitty's uploader contract, point 2), so re-granting is bounded (MAX_REGRANTS) and
 *    nothing that a new grant cannot fix (a refused PUT, a clock far ahead of the coordinator's) asks for one.
 *  - It does not decide WHAT to upload (the walker's job, after backupscan) or write the manifest (a later step; the
 *    manifest needs the name -> key map this returns).
 *  - MD5 is used only because S3 checks it as an integrity header. Chunk names and restore verification stay
 *    backupformat.js's HMAC and AEAD.
 *
 * Refusals reach the board as the tunnel's typed text, "... (HTTP <status> on <path>, code <code>)"; refusalOf()
 * reads the status and code back. Retry-After does not survive that text, so a quota refusal ends the run with
 * retryLater and the caller waits on its own clock.
 */
const crypto = require('crypto');

const GRANT_ROUTE = '/v1/org/backup/grant';
const MAX_PER_GRANT = 500;              // the coordinator's limit per grant request
const MIN_OBJECT = 4148;                // a sealed chunk's framing floor (backupformat's 4 KiB Padme floor plus framing)
const MAX_OBJECT = 5 * 1024 * 1024;     // the coordinator's per-object ceiling
const MAX_REGRANTS = 3;                 // new grants for uploads a grant could not finish, per batch
const BACKOFF_MAX_MS = 30 * 1000;      // a retry of the same url waits at most this long (it retries until expiry)
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 32;
const PUT_TIMEOUT_MS = 120 * 1000;
const SIGNED_NEEDED = ['content-length', 'content-md5', 'host', 'if-none-match', 'x-amz-object-lock-mode', 'x-amz-object-lock-retain-until-date'];
// The only headers a grant may ask the Mac to send (the coordinator lists four; Content-Length is tolerated if listed).
const HEADER_ALLOWED = new Set(['content-md5', 'if-none-match', 'x-amz-object-lock-mode', 'x-amz-object-lock-retain-until-date', 'content-length']);
const GRANT_WINDOW_MS = 15 * 60 * 1000;                 // the coordinator's grant lifetime (GRANT_SECS)
// The lock a grant may set, measured from the grant's own start (expires_at minus its window), never the Mac's clock:
// the coordinator locks to the end of the week plus 30 days (plus the window), or the next week's end in a week's
// last day, so 30 to about 38 days. Outside [29, 39] days is a coordinator bug that would lock data for the wrong time.
const LOCK_MIN_MS = 29 * 86400 * 1000, LOCK_MAX_MS = 39 * 86400 * 1000;
// Network-level failures worth another try (the bucket was not reached, or did not answer).
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CLOSED']);

const md5b64 = (buf) => crypto.createHash('md5').update(buf).digest('base64');

/* The request body for one batch: sizes and MD5s in order, plus a nonce that makes every body unique. */
function grantBody(objects) {
  return { chunks: objects.map((o) => ({ size: o.object.length, md5: md5b64(o.object) })), nonce: crypto.randomBytes(16).toString('hex') };
}

/* The status and refusal code from a refusal the tunnel passed back as text, or nulls when the text carries none. */
function refusalOf(because) {
  const m = /\(HTTP (\d{3}) on [^,)]+(?:, code ([a-z0-9_]+))?\)/.exec(String(because || ''));
  return m ? { status: Number(m[1]), code: m[2] || null } : { status: null, code: null };
}

/* A header map's value for a name, case-insensitively, or undefined. */
function headerOf(headers, name) {
  const want = name.toLowerCase();
  for (const k of Object.keys(headers)) if (k.toLowerCase() === want) return headers[k];
  return undefined;
}

/* expires_at as epoch milliseconds: an ISO-8601 string (the coordinator's form) or a number of seconds or
   milliseconds; NaN when it is neither. */
function expiryMs(v) {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return Date.parse(v);
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v;
  return NaN;
}

/* Check a grant answer against the batch it was asked for. Returns { ok: true, expiresAtMs, uploads } or
   { ok: false, because }. Every upload must bind exactly the bytes we asked to write. `allowHttp` is a test seam. */
function parseGrant(data, objects, allowHttp) {
  if (!data || typeof data !== 'object') return { ok: false, because: 'the grant answer is not an object' };
  const expiresAtMs = expiryMs(data.expires_at);
  if (!Number.isFinite(expiresAtMs)) return { ok: false, because: 'the grant answer has no readable expires_at' };
  if (!Array.isArray(data.uploads) || data.uploads.length !== objects.length) return { ok: false, because: 'the grant answer does not have one upload per chunk' };
  const uploads = [];
  const keys = new Set(), urls = new Set();
  for (let i = 0; i < objects.length; i++) {
    const u = data.uploads[i], o = objects[i].object;
    if (!u || typeof u !== 'object') return { ok: false, because: `upload ${i} is not an object` };
    if (typeof u.key !== 'string' || !u.key || u.key.length > 1024) return { ok: false, because: `upload ${i} has no usable key` };
    if (keys.has(u.key)) return { ok: false, because: `upload ${i} repeats a key` };
    keys.add(u.key);
    let url;
    try { url = new URL(String(u.url)); } catch { return { ok: false, because: `upload ${i} has no usable url` }; }
    if (!(url.protocol === 'https:' || (allowHttp && url.protocol === 'http:'))) return { ok: false, because: `upload ${i} is not https` };
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { return { ok: false, because: `upload ${i} has an undecodable url path` }; }
    if (!path.endsWith('/' + u.key)) return { ok: false, because: `upload ${i}'s url does not carry its key` };
    if (urls.has(url.toString())) return { ok: false, because: `upload ${i} repeats a url` };
    urls.add(url.toString());
    const signed = String(url.searchParams.get('X-Amz-SignedHeaders') || '').toLowerCase().split(';');
    for (const h of SIGNED_NEEDED) if (!signed.includes(h)) return { ok: false, because: `upload ${i} does not sign ${h}` };
    if (!u.headers || typeof u.headers !== 'object' || Array.isArray(u.headers)) return { ok: false, because: `upload ${i} has no headers` };
    const headers = {};
    const names = new Set();
    for (const [k, v] of Object.entries(u.headers)) {
      const lk = k.toLowerCase();
      if (!HEADER_ALLOWED.has(lk)) return { ok: false, because: `upload ${i} asks to send a header it may not (${k})` };
      if (names.has(lk)) return { ok: false, because: `upload ${i} lists ${lk} twice` };
      names.add(lk);
      if (typeof v !== 'string' && typeof v !== 'number') return { ok: false, because: `upload ${i} has a header that is not text` };
      if (!/^[\x20-\x7e]*$/.test(String(v))) return { ok: false, because: `upload ${i} has a header value that is not printable ASCII` };
      headers[k] = String(v);
    }
    // The grant must bind OUR bytes: the MD5 it signed is the one we asked for, and it is write-once. Content-Length
    // is signed (checked above) and set by fetch from the body; if the grant lists it anyway, it must be ours.
    if (headerOf(headers, 'content-md5') !== md5b64(o)) return { ok: false, because: `upload ${i} does not bind this chunk's MD5` };
    const cl = headerOf(headers, 'content-length');
    if (cl !== undefined && cl !== String(o.length)) return { ok: false, because: `upload ${i} does not bind this chunk's length` };
    if (headerOf(headers, 'if-none-match') !== '*') return { ok: false, because: `upload ${i} is not write-once` };
    // And the lock must be the one the plan says: COMPLIANCE, for 29 to 39 days from the grant's own start.
    if (headerOf(headers, 'x-amz-object-lock-mode') !== 'COMPLIANCE') return { ok: false, because: `upload ${i} is not a COMPLIANCE lock` };
    const retainMs = expiryMs(String(headerOf(headers, 'x-amz-object-lock-retain-until-date') || ''));
    const lockFor = retainMs - (expiresAtMs - GRANT_WINDOW_MS);
    if (!Number.isFinite(retainMs) || lockFor < LOCK_MIN_MS || lockFor > LOCK_MAX_MS) return { ok: false, because: `upload ${i}'s lock is not 29 to 39 days` };
    uploads.push({ key: u.key, url: url.toString(), headers });
  }
  return { ok: true, expiresAtMs, uploads };
}

/* One PUT. Never thrown; returns { kind, status, code }:
     stored   200: written now
     present  412 on a retry: an earlier attempt of ours on this key landed (see the header for why that is sound)
     expired  403 whose S3 body says the request expired: needs a new grant
     refused  412 on a first attempt, a redirect (never followed), any other 4xx or 403, or a LOCAL failure (fetch
              refusing the request itself: a bad header, a length mismatch, a bad url): nothing a retry or a new
              grant would change
     retry    5xx (SlowDown included), 429, 409 (a write to that key still in flight), a network failure or a
              timeout: another try on the SAME url while the grant lasts, never a new grant */
async function putOne(fetchFn, up, bytes, attempt, timeoutMs) {
  // (Never thrown: every failure is classified below.)
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs || PUT_TIMEOUT_MS);
  try {
    // redirect 'manual': a 3xx is returned, not followed, so the body never goes to an address the grant did not name.
    const r = await fetchFn(up.url, { method: 'PUT', headers: up.headers, body: bytes, redirect: 'manual', signal: ac.signal });
    let text = '';
    try { text = await r.text(); } catch { /* only the S3 error code is read */ }
    const code = (/<Code>([A-Za-z]+)<\/Code>/.exec(text) || [])[1] || null;
    const s = r.status;
    if (s === 200) return { kind: 'stored', status: s, code };
    if (s === 412) return { kind: attempt > 0 ? 'present' : 'refused', status: s, code };
    if (s === 403 && /expired/i.test(text)) return { kind: 'expired', status: s, code };
    if (s === 429 || s === 409 || s >= 500) return { kind: 'retry', status: s, code };
    return { kind: 'refused', status: s, code };
  } catch (err) {
    // A timeout (our abort) or a network-level failure is worth another try; anything else is fetch refusing the
    // request locally, which no retry fixes.
    const c = err && ((err.cause && err.cause.code) || err.code);
    if ((err && err.name === 'AbortError') || ac.signal.aborted || NETWORK_CODES.has(c)) return { kind: 'retry', status: null, code: c || 'timeout' };
    return { kind: 'refused', status: null, code: c || (err && err.name) || 'local' };
  } finally {
    clearTimeout(t);
  }
}

/* Upload sealed chunk objects ([{ name, object }]). deps: { macRequest, fetch?, now?, sleep?, allowHttp? (tests) }.
   Resolves { ok: true, keys } with keys a Map from each chunk's name to the key it is stored under, or
   { ok: false, because, code?, retryLater?, keys } with the chunks stored so far. Never throws. */
async function uploadChunks(deps, objects, opts) {
  const keys = new Map();
  try {
    return await uploadInner(deps, objects, opts, keys);
  } catch (err) {
    return { ok: false, because: `the uploader failed: ${(err && err.message) || err}`, keys };
  }
}
async function uploadInner(deps, objects, opts, keys) {
  const o = opts || {};
  if (!deps || typeof deps.macRequest !== 'function') return { ok: false, because: 'no signed-request function', keys };
  const fetchFn = deps.fetch || globalThis.fetch;
  if (typeof fetchFn !== 'function') return { ok: false, because: 'no fetch here', keys };
  const now = deps.now || Date.now;
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const conc = Number.isInteger(o.concurrency) && o.concurrency > 0 ? Math.min(o.concurrency, MAX_CONCURRENCY) : DEFAULT_CONCURRENCY;
  if (!Array.isArray(objects)) return { ok: false, because: 'no chunks', keys };
  for (const c of objects) {
    if (!c || typeof c.name !== 'string' || !Buffer.isBuffer(c.object)) return { ok: false, because: 'a chunk is not { name, object }', keys };
    if (c.object.length < MIN_OBJECT || c.object.length > MAX_OBJECT) return { ok: false, because: `a chunk is ${c.object.length} bytes, outside ${MIN_OBJECT} to ${MAX_OBJECT}`, keys };
  }
  // A name already stored (the same content twice in one run) is uploaded once.
  const todo = [];
  const byName = new Map();
  for (const c of objects) {
    const first = byName.get(c.name);
    if (first) { if (!first.object.equals(c.object)) return { ok: false, because: 'two chunks share a name but not their bytes', keys }; continue; }
    byName.set(c.name, c); todo.push(c);
  }

  for (let at = 0; at < todo.length; at += MAX_PER_GRANT) {
    let pending = todo.slice(at, at + MAX_PER_GRANT);
    for (let grants = 0; pending.length; grants++) {
      if (grants > MAX_REGRANTS) return { ok: false, because: `${pending.length} chunks were still not stored after ${MAX_REGRANTS + 1} grants`, keys };
      const g = await askGrant(deps.macRequest, pending, deps.allowHttp);
      if (!g.ok) return Object.assign({ ok: false, keys }, g.out);
      // A grant already over when it arrives is not a slow network but a clock ahead of the coordinator's: a new
      // grant would be "expired" too, and each spends allowance. Stop and say so.
      if (now() >= g.expiresAtMs) return { ok: false, because: `this computer's clock reads past the grant's expiry (${new Date(g.expiresAtMs).toISOString()}) as it arrives: check the clock`, keys };
      const left = [], stuck = [];
      let stop = null;
      await eachLimited(g.uploads.map((up, i) => [up, pending[i]]), conc, async ([up, c]) => {
        let troubled = false;
        for (let attempt = 0; ; attempt++) {
          if (stop) return;
          // Out of time on this grant. A chunk that met only bucket or network trouble does NOT get a new grant (that
          // spends allowance and could write a second locked copy if an answer was lost): the run ends retryLater.
          if (now() >= g.expiresAtMs) { (troubled ? stuck : left).push(c); return; }
          const r = await putOne(fetchFn, up, c.object, attempt, o.putTimeoutMs);
          if (r.kind === 'stored' || r.kind === 'present') { keys.set(c.name, up.key); return; }
          if (r.kind === 'expired') { left.push(c); return; }
          if (r.kind === 'refused') { stop = stop || `the bucket refused a chunk (${r.status ? 'HTTP ' + r.status : 'locally'}${r.code ? ' ' + r.code : ''}); a new grant would not change that`; return; }
          troubled = true;
          await sleep(Math.min(BACKOFF_MAX_MS, 500 * 2 ** attempt));
        }
      });
      if (stop) return { ok: false, because: stop, keys };
      if (stuck.length) return { ok: false, retryLater: true, because: `${stuck.length} chunks met only bucket or network trouble until their grant expired; try again later`, keys };
      pending = left;
    }
  }
  // Every chunk asked for has a key, or this is not a success.
  for (const c of todo) if (!keys.has(c.name)) return { ok: false, because: 'a chunk was left without a stored key', keys };
  return { ok: true, keys };
}

/* One grant request, with one fresh-nonce retry for a replayed body. { ok: true, expiresAtMs, uploads } or
   { ok: false, out: { because, code, retryLater } }. */
async function askGrant(macRequest, batch, allowHttp) {
  for (let i = 0; i < 2; i++) {
    let r;
    try { r = await macRequest('POST', GRANT_ROUTE, grantBody(batch)); } catch (err) { r = { ok: false, because: (err && err.message) || 'the grant request failed' }; }
    if (r && r.ok) {
      const p = parseGrant(r.data, batch, allowHttp);
      return p.ok ? p : { ok: false, out: { because: p.because } };
    }
    const because = (r && r.because) || 'Kosmos+ did not answer';
    const { status, code } = refusalOf(because);
    if (code === 'replayed' && i === 0) continue;   // a fresh nonce makes a new body; one retry
    return { ok: false, out: { because, code: code || undefined, retryLater: code === 'backup_quota' || status === 429 || undefined } };
  }
  return { ok: false, out: { because: 'the grant request was refused as replayed twice', code: 'replayed' } };
}

/* Run fn over items with at most n at once. */
async function eachLimited(items, n, fn) {
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; await fn(items[i]); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
}

module.exports = { GRANT_ROUTE, MAX_PER_GRANT, MIN_OBJECT, MAX_OBJECT, MAX_REGRANTS, BACKOFF_MAX_MS, grantBody, refusalOf, expiryMs, parseGrant, putOne, uploadChunks };

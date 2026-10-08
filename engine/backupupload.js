'use strict';
/* #5535 E0.6, the Mac half of the upload: sealed chunk objects (engine/backupformat.js sealNamedChunk) go to the
 * org's bucket through grants the coordinator signs. Coordinator slice 2's shape (Ice Cream Kitty, on #5535):
 *
 *   POST /v1/org/backup/grant  { chunks: [{ size, md5 }], nonce }   (signed by this Mac: remote.macRequest)
 *   -> { epoch, period, retain_until, expires_at, uploads: [{ key, url, headers }] }, one upload per chunk, in order.
 *
 * Each upload is a presigned PUT with Content-MD5, Content-Length and If-None-Match: * signed, so the bucket stores
 * exactly these bytes, once, under a key the coordinator chose (measured on #5535: a matching body 200, a different
 * body 400 BadDigest, a dropped signed header 403, a second PUT 412).
 *
 * What this module owns, and what it does not:
 *  - It checks that every grant binds OUR bytes (the MD5 and length it signed are the ones we asked for) before a
 *    single byte leaves, so a coordinator bug cannot make the Mac write something other than what it sealed.
 *  - It never retries a grant request as-is: each request carries a fresh nonce (the coordinator accepts a signed
 *    body once), and each new grant spends the member's allowance again (Kitty's uploader contract, point 2), so
 *    re-granting is bounded (MAX_REGRANTS).
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
const PUT_ATTEMPTS = 3;                 // tries per upload for a transient failure, inside one grant
const DEFAULT_CONCURRENCY = 4;
const PUT_TIMEOUT_MS = 120 * 1000;

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

/* Check a grant answer against the batch it was asked for. Returns { ok: true, expiresAtMs, uploads } or
   { ok: false, because }. Every upload must bind exactly the bytes we asked to write. */
function parseGrant(data, objects, opts) {
  const allowHttp = !!(opts && opts.allowHttp);   // tests only: a local stand-in for the bucket
  if (!data || typeof data !== 'object') return { ok: false, because: 'the grant answer is not an object' };
  const exp = Number(data.expires_at);
  if (!Number.isFinite(exp) || exp <= 0) return { ok: false, because: 'the grant answer has no expires_at' };
  const expiresAtMs = exp < 1e12 ? exp * 1000 : exp;   // seconds (the coordinator's unit) or milliseconds
  if (!Array.isArray(data.uploads) || data.uploads.length !== objects.length) return { ok: false, because: 'the grant answer does not have one upload per chunk' };
  const uploads = [];
  const keys = new Set();
  for (let i = 0; i < objects.length; i++) {
    const u = data.uploads[i], o = objects[i].object;
    if (!u || typeof u !== 'object') return { ok: false, because: `upload ${i} is not an object` };
    if (typeof u.key !== 'string' || !u.key || u.key.length > 1024) return { ok: false, because: `upload ${i} has no usable key` };
    if (keys.has(u.key)) return { ok: false, because: `upload ${i} repeats a key` };
    keys.add(u.key);
    let url;
    try { url = new URL(String(u.url)); } catch { return { ok: false, because: `upload ${i} has no usable url` }; }
    if (!(url.protocol === 'https:' || (allowHttp && url.protocol === 'http:'))) return { ok: false, because: `upload ${i} is not https` };
    if (!u.headers || typeof u.headers !== 'object' || Array.isArray(u.headers)) return { ok: false, because: `upload ${i} has no headers` };
    const headers = {};
    for (const [k, v] of Object.entries(u.headers)) {
      if (typeof v !== 'string' && typeof v !== 'number') return { ok: false, because: `upload ${i} has a header that is not text` };
      headers[k] = String(v);
    }
    // The grant must bind OUR bytes: the MD5 and length it signed are the ones we asked for, and it is write-once.
    if (headerOf(headers, 'content-md5') !== md5b64(o)) return { ok: false, because: `upload ${i} does not bind this chunk's MD5` };
    if (headerOf(headers, 'content-length') !== String(o.length)) return { ok: false, because: `upload ${i} does not bind this chunk's length` };
    if (headerOf(headers, 'if-none-match') !== '*') return { ok: false, because: `upload ${i} is not write-once` };
    uploads.push({ key: u.key, url: url.toString(), headers });
  }
  return { ok: true, expiresAtMs, uploads };
}

/* One PUT. Classified, never thrown:
     stored   200: written now
     present  412: already written. The key is this grant's and the PUT is write-once with the MD5 signed, so an
              earlier attempt of ours landed these exact bytes (its answer was lost).
     expired  403: the grant ran out (or its signature no longer holds): needs a new grant
     refused  any other 4xx: the bucket refused these bytes (a BadDigest would be a bug here): not retried
     retry    5xx, 429, a network failure or a timeout: worth another try inside the grant */
async function putOne(fetchFn, up, bytes, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs || PUT_TIMEOUT_MS);
  try {
    const r = await fetchFn(up.url, { method: 'PUT', headers: up.headers, body: bytes, signal: ac.signal });
    try { await r.arrayBuffer(); } catch { /* the body is not needed, only drained */ }
    if (r.status === 200) return 'stored';
    if (r.status === 412) return 'present';
    if (r.status === 403) return 'expired';
    if (r.status === 429 || r.status >= 500) return 'retry';
    return 'refused';
  } catch {
    return 'retry';
  } finally {
    clearTimeout(t);
  }
}

/* Upload sealed chunk objects ([{ name, object }]). deps: { macRequest, fetch, now?, sleep? }.
   Resolves { ok: true, keys } with keys a Map from each chunk's name to the key it is stored under, or
   { ok: false, because, code?, retryLater?, keys } with the chunks stored so far. Never throws. */
async function uploadChunks(deps, objects, opts) {
  const o = opts || {};
  const now = deps.now || Date.now;
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const keys = new Map();
  if (!Array.isArray(objects)) return { ok: false, because: 'no chunks', keys };
  for (const c of objects) {
    if (!c || typeof c.name !== 'string' || !Buffer.isBuffer(c.object)) return { ok: false, because: 'a chunk is not { name, object }', keys };
    if (c.object.length < MIN_OBJECT || c.object.length > MAX_OBJECT) return { ok: false, because: `a chunk is ${c.object.length} bytes, outside ${MIN_OBJECT} to ${MAX_OBJECT}`, keys };
  }
  // A name already stored (the same content twice in one run) is uploaded once.
  const todo = [];
  const seen = new Set();
  for (const c of objects) if (!seen.has(c.name)) { seen.add(c.name); todo.push(c); }

  for (let at = 0; at < todo.length; at += MAX_PER_GRANT) {
    let pending = todo.slice(at, at + MAX_PER_GRANT);
    for (let grants = 0; pending.length; grants++) {
      if (grants > MAX_REGRANTS) return { ok: false, because: `${pending.length} chunks were still not stored after ${MAX_REGRANTS + 1} grants`, keys };
      const g = await askGrant(deps.macRequest, pending, o);
      if (!g.ok) return Object.assign({ ok: false, keys }, g.out);
      const left = [];
      await eachLimited(g.uploads.map((up, i) => [up, pending[i]]), o.concurrency || DEFAULT_CONCURRENCY, async ([up, c]) => {
        for (let tries = 0; ; tries++) {
          if (now() >= g.expiresAtMs) { left.push(c); return; }
          const r = await putOne(deps.fetch, up, c.object, o.putTimeoutMs);
          if (r === 'stored' || r === 'present') { keys.set(c.name, up.key); return; }
          if (r === 'expired') { left.push(c); return; }
          if (r === 'refused' || tries + 1 >= PUT_ATTEMPTS) { left.push(c); return; }
          await sleep(500 * 2 ** tries);
        }
      });
      pending = left;
    }
  }
  return { ok: true, keys };
}

/* One grant request, with one fresh-nonce retry for a replayed body. { ok: true, expiresAtMs, uploads } or
   { ok: false, out: { because, code, retryLater } }. */
async function askGrant(macRequest, batch, o) {
  for (let i = 0; i < 2; i++) {
    let r;
    try { r = await macRequest('POST', GRANT_ROUTE, grantBody(batch)); } catch (err) { r = { ok: false, because: (err && err.message) || 'the grant request failed' }; }
    if (r && r.ok) {
      const p = parseGrant(r.data, batch, o);
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

module.exports = { GRANT_ROUTE, MAX_PER_GRANT, MIN_OBJECT, MAX_OBJECT, MAX_REGRANTS, PUT_ATTEMPTS, grantBody, refusalOf, parseGrant, putOne, uploadChunks };

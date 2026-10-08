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
 * the two lock headers (six, all required here); `headers` lists exactly what to send (Content-Length and Host are the HTTP client's, so they are
 * NOT in it). Measured on #5535: a matching body 200, a different body 400 BadDigest, a dropped signed header 403, a
 * second PUT 412. Keys are random per upload (two new ids), and each url's path ends with its key.
 *
 * What this module owns, and what it does not:
 *  - Before a single byte leaves, every grant must bind OUR bytes: the MD5 in its headers is the one we asked for, a
 *    Content-Length (if listed) is the chunk's length, X-Amz-SignedHeaders covers those six headers, If-None-Match is
 *    `*`, the url carries exactly SigV4's six query parameters and a signed time that agrees with expires_at, its host
 *    is an AWS S3 endpoint (path-style or virtual-hosted, never a website endpoint), the url is https and carries the upload's own key, and no url or key
 *    repeats. A coordinator bug cannot make the Mac write something other than what it sealed.
 *  - 412 counts as stored only after an earlier attempt on that key that MAY HAVE WRITTEN it (a lost answer, a failure
 *    after S3 received the request); not after pre-connect failures or S3's "nothing committed" answers. The key
 *    is random and only this grant's url, whose signature fixes our MD5, can write it, so whatever holds it is our
 *    bytes. (The uploader holds no read grant, so it cannot check the object's ETag as the coordinator's doc
 *    suggests; the url-to-key binding above is what makes the 412 rule sound instead.) A 412 on the FIRST attempt
 *    means the key was not ours to write: refused.
 *  - Bucket or network trouble (a lost answer, 5xx or SlowDown, 409 a write still in flight) is retried on the SAME
 *    url until the grant expires, never with a new grant (Ice Cream Kitty, from S3's docs): a landed write shows up
 *    as that 412 rather than as a second copy, and a chunk that met only such trouble until expiry ends the run
 *    retryLater, naming those chunks and keys as `unsure` (a later run writes them again, so a landed one is a locked
 *    orphan until its lock ends). Only a chunk the grant ran out on cleanly (a big batch, or a 403 that says expired)
 *    gets a new grant under a new key; MAX_REGRANTS + 1 grants in a row that store nothing end the run retryLater.
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
const MAX_REGRANTS = 3;                 // grants in a row that store nothing before the run gives up
const INITIAL_BATCH = 8;                // the first grant's size; later ones follow the rate achieved (uploadInner)
const BACKOFF_MAX_MS = 30 * 1000;      // a retry of the same url waits at most this long (it retries until expiry)
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 32;
// A PUT may take 60 s plus the time to send its bytes at 16 KB/s shared by the workers sending at once (5 MiB with
// four workers: about 22 minutes). Not capped at the grant: S3 checks expiry when a request arrives.
const putTimeoutFor = (size, workers) => 60 * 1000 + Math.ceil((size * Math.max(1, workers || 1)) / 16);
const SIGNED_NEEDED = ['content-length', 'content-md5', 'host', 'if-none-match', 'x-amz-object-lock-mode', 'x-amz-object-lock-retain-until-date'];
// The only headers a grant may ask the Mac to send (the coordinator lists four; Content-Length is tolerated if listed).
const HEADER_ALLOWED = new Set(['content-md5', 'if-none-match', 'x-amz-object-lock-mode', 'x-amz-object-lock-retain-until-date', 'content-length']);
const GRANT_WINDOW_MS = 15 * 60 * 1000;                 // the coordinator's grant lifetime (GRANT_SECS)
// The only query parameters a grant's url may carry: SigV4's own. S3 honours x-amz-* request parameters in the query
// too (a legal hold, a retention, tagging, a multipart uploadId), which would act on the locked bucket unseen by the
// header checks, so any other parameter refuses the grant.
const S3_HOST = /^([a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\.)?s3([.-][a-z0-9-]+)?\.amazonaws\.com$/;
const QUERY_ALLOWED = ['X-Amz-Algorithm', 'X-Amz-Credential', 'X-Amz-Date', 'X-Amz-Expires', 'X-Amz-SignedHeaders', 'X-Amz-Signature'];
// The lock a grant may set, measured from the url's SIGNED time (X-Amz-Date), never the Mac's clock: the coordinator
// locks to the end of the week plus 30 days plus the window, or the next week's end in a week's last day, so about
// 31 days 15 minutes to 38 days 15 minutes. Outside [29, 39] days is a coordinator bug that would lock for the wrong time.
const LOCK_MIN_MS = 29 * 86400 * 1000, LOCK_MAX_MS = 39 * 86400 * 1000;
// fetch refusing the request itself, before or without the network: no retry fixes these. Any other failure (a
// network code, known or not: ENETDOWN, EADDRNOTAVAIL under the macOS TIME_WAIT leak, a TLS error) is worth another try.
// Failures before any byte of the body could have left (no DNS answer, nothing listening, TLS refused): retried, but
// such an attempt cannot have written anything, so it never makes a chunk "unsure".
// (Not ENETDOWN, ENETUNREACH or EHOSTUNREACH: those can also end an established socket after the body was sent.)
const PRECONNECT_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID']);
const LOCAL_CODES = new Set(['UND_ERR_REQ_CONTENT_LENGTH_MISMATCH', 'UND_ERR_INVALID_ARG', 'UND_ERR_NOT_SUPPORTED',
  'ERR_INVALID_URL', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE', 'ERR_INVALID_HTTP_TOKEN', 'ERR_INVALID_CHAR']);

// The ONLY way to allow plain-http upload urls (and a host that is not AWS S3, the local test bucket): a test calls
// allowHttpForTests(true). Not an argument or an environment variable, which a production caller or a child process
// could pass on by mistake.
let httpForTests = false;
function allowHttpForTests(on) { httpForTests = !!on && !!process.env.NODE_TEST_CONTEXT; }   // and only under node --test

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
  // An explicit zone is required: without one Date.parse reads the time as LOCAL, hours off on a Mac.
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(v)) return Date.parse(v);
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v;
  return NaN;
}

/* Check a grant answer against the batch it was asked for. Returns { ok: true, expiresAtMs, uploads } or
   { ok: false, because }. Every upload must bind exactly the bytes we asked to write. `seenKeys` (optional) holds
   every key granted earlier in this run: a grant repeating one is refused, since the 412-on-retry rule rests on keys
   being unique across the run, not only within one grant. */
function parseGrant(data, objects, seenKeys, runBucket) {
  const allowHttp = httpForTests;
  if (!data || typeof data !== 'object') return { ok: false, because: 'the grant answer is not an object' };
  const expiresAtMs = expiryMs(data.expires_at);
  if (!Number.isFinite(expiresAtMs)) return { ok: false, because: 'the grant answer has no readable expires_at' };
  if (!Array.isArray(data.uploads) || data.uploads.length !== objects.length) return { ok: false, because: 'the grant answer does not have one upload per chunk' };
  const uploads = [];
  const keys = new Set(), urls = new Set();
  let bucketPrefix = null, minExpiresS = Infinity;
  for (let i = 0; i < objects.length; i++) {
    const u = data.uploads[i], o = objects[i].object;
    if (!u || typeof u !== 'object') return { ok: false, because: `upload ${i} is not an object` };
    if (typeof u.key !== 'string' || !u.key || u.key.length > 1024) return { ok: false, because: `upload ${i} has no usable key` };
    if (keys.has(u.key)) return { ok: false, because: `upload ${i} repeats a key` };
    if (seenKeys && seenKeys.has(u.key)) return { ok: false, because: `upload ${i} repeats a key an earlier grant in this run already gave` };
    keys.add(u.key);
    let url;
    try { url = new URL(String(u.url)); } catch { return { ok: false, because: `upload ${i} has no usable url` }; }
    if (urls.has(url.toString())) return { ok: false, because: `upload ${i} repeats a url` };
    urls.add(url.toString());
    if (!(url.protocol === 'https:' || (allowHttp && url.protocol === 'http:'))) return { ok: false, because: `upload ${i} is not https` };
    // The bucket is AWS S3: the Mac sends its bytes only to an S3 endpoint on the default port, whatever host a grant
    // names (a coordinator bug cannot point it at a LAN address or another service). Path-style s3.<region> or
    // s3-<region>, or virtual-hosted <bucket>.s3.<region>. This pins the SERVICE, not the bucket: the Mac holds no
    // bucket name of its own, so a grant naming another bucket on S3 passes; the payload is sealed either way.
    if (!allowHttp && (url.port || !S3_HOST.test(url.hostname) || /s3-website/.test(url.hostname))) return { ok: false, because: `upload ${i}'s host is not an AWS S3 endpoint (${url.host})` };
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { return { ok: false, because: `upload ${i} has an undecodable url path` }; }
    if (!path.endsWith('/' + u.key)) return { ok: false, because: `upload ${i}'s url does not carry its key` };
    // The path is the key itself (a virtual-hosted bucket) or one bucket segment and the key (path-style), nothing
    // else, so the key the map records is the object S3 stores. And one bucket path per grant.
    const pre = path.slice(0, path.length - u.key.length);
    // A virtual-hosted S3 host (<bucket>.s3.<region>.amazonaws.com) names the bucket already: the path is the key.
    const virtualHosted = /\.s3[.-]([a-z0-9-]+\.)?amazonaws\.com$/.test(url.hostname);
    if (virtualHosted && pre !== '/') return { ok: false, because: `upload ${i}'s url path is not its key (a virtual-hosted bucket)` };
    // A path-style S3 host takes the FIRST segment as the bucket, so there the key must follow exactly one segment.
    if (!virtualHosted && !allowHttp && !/^\/[^/]+\/$/.test(pre)) return { ok: false, because: `upload ${i}'s url path is not one bucket segment and its key (a path-style host)` };
    // (For an https S3 host the two checks above already decide; this one is reached only by the test setter's urls.)
    if (!(pre === '/' || /^\/[^/]+\/$/.test(pre))) return { ok: false, because: `upload ${i}'s url path is not its key under one bucket segment` };
    const prefix = `${url.host}${pre}`;
    if (i === 0) bucketPrefix = prefix; else if (prefix !== bucketPrefix) return { ok: false, because: `upload ${i}'s url is not under the grant's bucket path` };
    const qnames = [...url.searchParams.keys()];
    for (const q of qnames) if (!QUERY_ALLOWED.includes(q)) return { ok: false, because: `upload ${i}'s url carries a parameter it may not (${q})` };
    if (new Set(qnames).size !== qnames.length) return { ok: false, because: `upload ${i}'s url repeats a parameter` };
    for (const q of QUERY_ALLOWED) if (!url.searchParams.get(q)) return { ok: false, because: `upload ${i}'s url has no ${q}` };
    // The signing time is the one the url's signature covers; expires_at must agree with it, and the lock is measured
    // from it, so a field outside the signature cannot move the lock.
    const dm = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(url.searchParams.get('X-Amz-Date'));
    if (!dm) return { ok: false, because: `upload ${i}'s url has no readable X-Amz-Date` };
    const signedAtMs = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +dm[4], +dm[5], +dm[6]);
    const signed = String(url.searchParams.get('X-Amz-SignedHeaders') || '').toLowerCase().split(';');
    // The url itself must not outlive a grant: X-Amz-Expires (seconds) at most the window.
    const xe = Number(url.searchParams.get('X-Amz-Expires'));
    if (!Number.isInteger(xe) || xe <= 0 || xe * 1000 > GRANT_WINDOW_MS) return { ok: false, because: `upload ${i}'s url lasts longer than a grant` };
    // And not uselessly short: under a minute, the deadline's 10 s margin leaves no time to send anything, and each
    // such grant would spend allowance for nothing.
    if (xe < 60) return { ok: false, because: `upload ${i}'s url lasts under a minute` };
    minExpiresS = Math.min(minExpiresS, xe);
    if (Math.abs(signedAtMs + xe * 1000 - expiresAtMs) > 60 * 1000) return { ok: false, because: `upload ${i}'s signed time does not match the grant's expires_at` };
    for (const h of SIGNED_NEEDED) if (!signed.includes(h)) return { ok: false, because: `upload ${i} does not sign ${h}` };
    if (signed.length !== SIGNED_NEEDED.length) return { ok: false, because: `upload ${i} signs headers outside the six it may` };
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
    // An ISO string only (a bare number would pass expiryMs but be sent as text S3 refuses).
    const retainRawKey = Object.keys(u.headers).find((k) => k.toLowerCase() === 'x-amz-object-lock-retain-until-date');
    const retainMs = retainRawKey && typeof u.headers[retainRawKey] === 'string' ? expiryMs(u.headers[retainRawKey]) : NaN;
    const lockFor = retainMs - signedAtMs;   // from the grant's own (signed) start
    if (!Number.isFinite(retainMs) || lockFor < LOCK_MIN_MS || lockFor > LOCK_MAX_MS) return { ok: false, because: `upload ${i}'s lock is not 29 to 39 days` };
    uploads.push({ key: u.key, url: url.toString(), headers });
  }
  // One bucket for the whole run (runBucket: { prefix } set by the first grant), so a later grant cannot move this run's
  // locked objects to another bucket that the run's key map does not name.
  if (runBucket) {
    if (runBucket.prefix && runBucket.prefix !== bucketPrefix) return { ok: false, because: `the grant names another bucket (${bucketPrefix}) than this run's first (${runBucket.prefix})` };
  }
  return { ok: true, expiresAtMs, lifetimeMs: minExpiresS * 1000, uploads, bucketPrefix };
}

/* One PUT. Never thrown; returns { kind, status, code }:
     stored   200: written now
     present  412 after an earlier attempt on this key that may have written it (see the header for why that is sound)
     expired  403 whose S3 body says the request expired: needs a new grant
     refused  412 on a first attempt, a redirect (never followed), any other 4xx or 403, or a LOCAL failure (fetch
              refusing the request itself: a bad header, a length mismatch, a bad url): nothing a retry or a new
              grant would change
     retry    5xx (SlowDown included), 429, 409 (a write to that key still in flight), a network failure or a
              timeout: another try on the SAME url while the grant lasts, never a new grant */
async function putOne(fetchFn, up, bytes, mayHaveLanded, timeoutMs) {
  // (Never thrown: every failure is classified below.)
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), Math.max(1, timeoutMs || putTimeoutFor(bytes.length)));
  try {
    // redirect 'manual': a 3xx is returned, not followed, so the body never goes to an address the grant did not name.
    // (So S3's 301/307 for a wrong-region or brand-new bucket ends the run as refused: a coordinator config fault.)
    const r = await fetchFn(up.url, { method: 'PUT', headers: up.headers, body: bytes, redirect: 'manual', signal: ac.signal });
    // Only S3's <Code> and <Message> are read: at most the first 8 KB of a body from a host the grant named.
    let text = '';
    if (r.status !== 200) { try { text = await headOf(r, 8192); } catch { /* the code is optional */ } }
    else { try { await r.body?.cancel(); } catch { /* nothing to read */ } }
    const code = (/<Code>([A-Za-z]+)<\/Code>/.exec(text) || [])[1] || null;
    const s = r.status;
    if (s === 200) return { kind: 'stored', status: s, code };
    // Stored only if an EARLIER attempt on this key may have written it (its answer was lost, or S3 failed after
    // receiving it); after nothing but pre-connect failures or "nothing committed" answers, a 412 is not ours.
    if (s === 412) return { kind: mayHaveLanded ? 'present' : 'refused', status: s, code };
    // Only S3's presigned-url expiry ("Request has expired", AccessDenied), not a credential's (ExpiredToken).
    if (s === 403 && code === 'AccessDenied' && /Request has expired/.test(text)) return { kind: 'expired', status: s, code };
    // 400 RequestTimeout (the socket sat idle) and IncompleteBody (fewer bytes than signed arrived): nothing was
    // committed, and a slow link meets both, so the same url is tried again. 501 NotImplemented never changes.
    if (s === 400 && (code === 'RequestTimeout' || code === 'IncompleteBody')) return { kind: 'retry', status: s, code, nothingCommitted: true };
    if (s === 501) return { kind: 'refused', status: s, code };
    if (s === 429 || s === 409 || s >= 500) return { kind: 'retry', status: s, code };
    return { kind: 'refused', status: s, code };
  } catch (err) {
    // fetch refusing the request itself (a listed local code, or a TypeError with no cause: its own argument check)
    // is not retried; a timeout (our abort) or any network failure is.
    const c = err && ((err.cause && err.cause.code) || err.code);
    const local = LOCAL_CODES.has(c) || (err && err.name === 'TypeError' && !err.cause && !ac.signal.aborted);
    if (local) return { kind: 'refused', status: null, code: c || 'local' };
    const pre = !ac.signal.aborted && (PRECONNECT_CODES.has(c) || /^ERR_TLS_/.test(String(c || '')));
    return { kind: 'retry', status: null, code: ac.signal.aborted ? 'timeout' : (c || 'network'), preconnect: pre };
  } finally {
    clearTimeout(t);
  }
}

/* The first `max` bytes of a response body as text; the rest is not read (the stream is cancelled). */
async function headOf(r, max) {
  if (!r.body || typeof r.body.getReader !== 'function') return String((await r.text()) || '').slice(0, max);
  const reader = r.body.getReader();
  const parts = [];
  let n = 0;
  try {
    while (n < max) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(Buffer.from(value)); n += value.length;
    }
  } finally { try { await reader.cancel(); } catch { /* already closed */ } }
  return Buffer.concat(parts).subarray(0, max).toString('utf8');
}

/* Upload sealed chunk objects ([{ name, object }]). deps: { macRequest, fetch?, now?, sleep? }.
   Resolves { ok: true, keys } with keys a Map from each chunk's name to the key it is stored under, or
   { ok: false, because, code?, retryLater?, keys } with the chunks stored so far. Never throws. */
async function uploadChunks(deps, objects, opts) {
  const keys = new Map();
  // Run-wide: chunks that met trouble and are not stored (their write may have landed), and every key granted.
  const run = { troubled: new Map(), seenKeys: new Set(), bucket: { prefix: null } };
  try {
    return await uploadInner(deps, objects, opts, keys, run);
  } catch (err) {
    const unsure = [...run.troubled.values()].map((x) => ({ name: x.c.name, key: x.key }));
    return Object.assign({ ok: false, because: `the uploader failed: ${(err && err.message) || err}`, keys }, unsure.length ? { unsure } : {});
  }
}
async function uploadInner(deps, objects, opts, keys, run) {
  const o = opts || {};
  if (!deps || typeof deps.macRequest !== 'function') return { ok: false, because: 'no signed-request function', keys };
  const fetchFn = deps.fetch || globalThis.fetch;
  if (typeof fetchFn !== 'function') return { ok: false, because: 'no fetch here', keys };
  const now = deps.now || Date.now;
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const conc = Number.isInteger(o.concurrency) && o.concurrency > 0 ? Math.min(o.concurrency, MAX_CONCURRENCY) : DEFAULT_CONCURRENCY;
  // A test seam; a value that is not a positive number falls back to the size-based timeout.
  const timeoutFor = (size) => (Number.isFinite(o.putTimeoutMs) && o.putTimeoutMs > 0 ? o.putTimeoutMs : putTimeoutFor(size, conc));
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

  // Grants are sized to what one window can carry: they start at INITIAL_BATCH, and each next grant is sized from the
  // rate the last one achieved (see below). So a slow uplink is charged for roughly what it sends.
  let queue = todo.slice();
  let batch = Math.min(INITIAL_BATCH, MAX_PER_GRANT);
  let fruitless = 0;
  while (queue.length) {
    const pending = queue.splice(0, batch);
    // The grant's clock starts when it is ASKED for (the coordinator signs between then and its answer), on this Mac's
    // clock, so the deadline below never runs past the real expiry because the answer was slow.
    const asked = now();
    const g = await askGrant(deps.macRequest, pending, run.seenKeys, run.bucket);
    if (!g.ok) return Object.assign({ ok: false, keys }, g.out);
    for (const u of g.uploads) run.seenKeys.add(u.key);
    if (!run.bucket.prefix) run.bucket.prefix = g.bucketPrefix;
    // A grant already over when it arrives is not a slow network but a clock ahead of the coordinator's: a new grant
    // would be "expired" too, and each spends allowance. Stop and say so.
    // Both directions get the same hour: within it, a Mac clock that is off still works, since the deadline below is
    // measured on this Mac's own clock and S3 never reads it.
    if (now() - g.expiresAtMs > 60 * 60 * 1000) return { ok: false, because: `this computer's clock reads over an hour past the grant's expiry (${new Date(g.expiresAtMs).toISOString()}) as it arrives: one of the two clocks is wrong (this grant's allowance is spent)`, keys };
    // And never far ahead of this Mac's clock (more than the window plus an hour): one of the two clocks is wrong.
    // (An hour of tolerance: a Mac a few minutes slow still backs up; S3 itself refuses a request whose signing time is
    // more than 15 minutes off its own clock.)
    if (g.expiresAtMs - now() > GRANT_WINDOW_MS + 60 * 60 * 1000) return { ok: false, because: `the grant expires ${new Date(g.expiresAtMs).toISOString()}, over an hour further ahead of this computer's clock than a grant lasts: one of the two clocks is wrong (this grant's allowance is spent)`, keys };
    // This grant's deadline on THIS Mac's clock: when it was asked for plus the url's own lifetime, less a 10 s
    // margin. So a Mac clock that is minutes off does not end a grant early or late (the skew checks above catch a
    // clock that is far off). The PUTs are bounded by S3's own check on arrival either way.
    const deadline = asked + g.lifetimeMs - 10 * 1000;
    const left = [], stuck = [];   // stuck: [{ chunk, key }], a write that may have landed under key
    const unreached = [];           // chunks that met only pre-connect failures until the deadline: nothing written
    const troubledNow = run.troubled; // name -> { c, key } for chunks that met trouble and are not (yet) stored
    let stop = null, stored = 0;
    await eachLimited(g.uploads.map((up, i) => [up, pending[i]]), conc, async ([up, c]) => {
      let troubled = false, preOnly = false;
      for (let attempt = 0; ; attempt++) {
        if (stop) return;
        // Out of time on this grant. A chunk that met bucket or network trouble does NOT get a new grant (that spends
        // allowance and could write a second locked copy if an answer was lost): the run ends retryLater.
        const remaining = deadline - now();
        if (remaining <= 0) { if (troubled) stuck.push({ c, key: up.key }); else if (preOnly) unreached.push(c); else left.push(c); return; }
        // NOT capped at the grant's remaining time: S3 checks a presigned url's expiry when the request ARRIVES, so a PUT
        // started in time may finish after it. Aborting it at the deadline would turn a landed write into an unknown.
        const r = await putOne(fetchFn, up, c.object, troubled, timeoutFor(c.object.length));
        if (r.kind === 'stored' || r.kind === 'present') { keys.set(c.name, up.key); troubledNow.delete(c.name); stored++; return; }
        // S3 says the grant expired. After trouble that is the same case as above: an earlier attempt may have landed.
        if (r.kind === 'expired') { if (troubled) stuck.push({ c, key: up.key }); else left.push(c); return; }
        if (r.kind === 'refused') { stop = stop || `the bucket refused a chunk (${r.status ? 'HTTP ' + r.status : 'locally'}${r.code ? ' ' + r.code : ''}); a new grant would not change that`; return; }
        // troubled: an attempt that may have written this chunk (a lost answer, a failure after S3 got the request).
        // Not a pre-connect failure, and not S3 saying it committed nothing.
        if (r.preconnect) { preOnly = true; } else if (!r.nothingCommitted) { troubled = true; troubledNow.set(c.name, { c, key: up.key }); }
        // Jittered, so workers that met the same SlowDown do not retry in lockstep.
        await sleep(Math.min(BACKOFF_MAX_MS, 500 * 2 ** attempt) * (0.5 + Math.random() / 2));
      }
    });
    // A refusal stops the run; chunks that met trouble on the way may still have landed, so they are named too.
    if (stop) {
      const unsure = [...troubledNow.values()].map((x) => ({ name: x.c.name, key: x.key }));
      return Object.assign({ ok: false, because: stop, keys }, unsure.length ? { unsure } : {});
    }
    // unsure: chunks whose write may have landed under these keys (an answer was lost). A later run uploads them again
    // under new keys, so a landed one becomes a locked orphan until its lock ends; the caller may record them.
    // The bucket could not even be reached: no new grant (it could not be reached either), and nothing is unsure.
    if (unreached.length && !stuck.length) return { ok: false, retryLater: true, because: `the bucket could not be reached (${unreached.length} chunks never connected before their grant ran out); try again later`, keys };
    if (stuck.length) return { ok: false, retryLater: true, because: `${stuck.length} chunks met bucket or network trouble until their grant expired; try again later`, keys, unsure: stuck.map((x) => ({ name: x.c.name, key: x.key })) };
    // The next grant is sized from the RATE this one achieved: about 80% of what the link carries in one window,
    // never more than double this grant (so it settles instead of swinging), at least 1, at most MAX_PER_GRANT.
    // A grant that ran out (chunks left) counts as having used its whole window, whatever the clock says: S3 can end a
    // grant early (a coordinator clock behind S3's), and a short elapsed would read as a fast link and over-ask.
    const elapsed = Math.max(1, now() - asked, left.length ? g.lifetimeMs : 0);
    const fits = Math.floor((stored * g.lifetimeMs * 0.8) / elapsed);
    batch = Math.max(1, Math.min(MAX_PER_GRANT, batch * 2, fits));
    if (left.length) {
      fruitless = stored ? 0 : fruitless + 1;
      if (fruitless > MAX_REGRANTS) return { ok: false, retryLater: true, because: `${MAX_REGRANTS + 1} grants in a row stored nothing before they expired; try again later`, keys };
      queue = left.concat(queue);
    } else {
      fruitless = 0;
    }
  }
  // Every chunk asked for has a key, or this is not a success.
  for (const c of todo) if (!keys.has(c.name)) return { ok: false, because: 'a chunk was left without a stored key', keys };
  return { ok: true, keys };
}

/* One grant request, with one fresh-nonce retry for a replayed body. { ok: true, expiresAtMs, uploads } or
   { ok: false, out: { because, code, retryLater } }. */
async function askGrant(macRequest, batch, seenKeys, runBucket) {
  for (let i = 0; i < 2; i++) {
    let r;
    try { r = await macRequest('POST', GRANT_ROUTE, grantBody(batch)); } catch (err) { r = { ok: false, because: (err && err.message) || 'the grant request failed' }; }
    if (r && r.ok) {
      const p = parseGrant(r.data, batch, seenKeys, runBucket);
      return p.ok ? p : { ok: false, out: { because: p.because } };
    }
    const because = (r && r.because) || 'Kosmos+ did not answer';
    const { status, code } = refusalOf(because);
    if (code === 'replayed' && i === 0) continue;   // a fresh nonce makes a new body; one retry
    // No status at all: the request did not get an answer (network, timeout, the tunnel), so a later run may work.
    // (r.notSent is the board refusing before sending: not enrolled, or busy; that is not "later" by itself.)
    const transient = status === null && !(r && r.notSent);
    return { ok: false, out: { because, code: code || undefined, retryLater: code === 'backup_quota' || status === 429 || transient || undefined } };
  }
  return { ok: false, out: { because: 'the grant request was refused as replayed twice', code: 'replayed' } };
}

/* Run fn over items with at most n at once. If one throws, no worker starts another item, every worker in flight is
   awaited, and only then is the first error thrown: nothing keeps uploading after the caller has its result. */
async function eachLimited(items, n, fn) {
  let next = 0, failed = null;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try { await fn(items[i]); } catch (err) { failed = failed || { err }; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
  if (failed) throw failed.err;
}

module.exports = { allowHttpForTests, GRANT_ROUTE, MAX_PER_GRANT, MIN_OBJECT, MAX_OBJECT, MAX_REGRANTS, INITIAL_BATCH, BACKOFF_MAX_MS, grantBody, refusalOf, expiryMs, parseGrant, putOne, uploadChunks };

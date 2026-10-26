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
 * chunks one at a time. So runRestore hands plan() every chunk key in the order restore will fetch them (file by file),
 * plan() grants the first batch at once (so a refusal stops the restore before any file, with its reason), and each
 * later batch is granted on its first fetch. A URL near its expiry, or one S3 answers as expired, is granted again for
 * the keys of its batch not yet fetched, never per chunk. A refusal (a 429 included) stops every later fetch with its
 * reason (planned().because); a grant that could not be reached is tried again on the next fetch, at most
 * MAX_UNREACHED times in all.
 *
 * Expiry is kept on THIS computer's clock (review 1): a URL counts as usable for URL_LIFETIME_MS from when its grant was
 * asked for. expires_at is on the coordinator's clock, so comparing it with a clock a few minutes fast made every URL
 * look stale the moment it arrived; it is still required in the answer, and S3's own expired answer is the backstop.
 *
 * Nothing it is handed is trusted for content: every answer must echo the request (member, epoch, the manifest's key,
 * the recorded sha256 and size) and name exactly the keys asked for; every URL must be https, on the manifest URL's own
 * host, with a path that ends in its key, and never a bare IP address or localhost (review 1: otherwise a breached
 * coordinator could point this computer's GETs anywhere); nothing is redirected and no body is read past maxBytes.
 * runRestore and backuprestore then check every byte against the device-signed manifest, so a wrong URL reads as a
 * failure, never as the member's data.
 *
 * A time limit that is the route's, not this module's (review 5): a reviewer's read grant needs a release by that
 * reviewer in the last 15 minutes, and links are granted again about every 4.5 minutes, so a restore through a
 * reviewer's session that runs past the release's 15 minutes is refused part way (403 read_needs_release). The caller
 * should turn that refusal into a sentence saying the release lapsed and must be made again; this module stops on it
 * and returns what was restored (partial). The destination's grant (r4) is expected to ride on its released request
 * instead.
 *
 * Not here, and refused by name instead (#5536 comment 6404447686; the open card for it is #7156): a chunk under
 * another key epoch. backupsnapshot.js keeps an indexed chunk's epoch on purpose, the route grants only the request's
 * epoch, and runRestore opens with one member key, so a snapshot taken after a rotation inside its week names chunks
 * this restore cannot read yet.
 */

const GRANT_KEYS = 500;   // the route's most keys in one call
const URL_LIFETIME_MS = 300000;   // the route's presigned GETs last 5 minutes
const EXPIRY_MARGIN_MS = 30000;   // a URL this close to its expiry is granted again before it is used
// restorerun cuts each fetch off at FETCH_TIMEOUT_MS (2 min). The worst path inside one chunk's fetch is a grant, a
// GET, the wait, a second grant and a second GET: 15 + 40 + 2 + 15 + 40 = 112 s (reviews 1 to 3). A grant answering after its
// cut-off is not kept: it costs at most one more call, and keeping it would race the second try (review 3, declined).
const GET_TIMEOUT_MS = 40000;
const GRANT_TIMEOUT_MS = 15000;   // a grant that does not answer in this long reads as not reached (review 2)
const RETRY_WAIT_MS = 2000;   // before a second try at a grant that was not reached
// The manifest can be 64 MB where a chunk is a few: ONE GET with most of the 2 minutes, after up to two grants (a
// blip there must not fail the restore): 15 + 2 + 15 + 78 = 110 s, 10 s inside the 2 minutes (reviews 4 and 6).
const MANIFEST_GET_TIMEOUT_MS = 78000;
const MAX_UNREACHED = 3;   // grants in a row that could not be reached before the restore gives up
const LINKS_EXPIRED = 'the storage service says each download link had already expired, so the clock on this computer or on Kosmos+ may be wrong';
const HEX64_RE = /^[0-9a-f]{64}$/;
const ANOTHER_EPOCH = 'this backup names files sealed under another key of this member, which restore cannot read yet';
const BAD_LINK = 'Kosmos+ sent back a download link restore will not use';
const OTHER_FILES = 'Kosmos+ sent back links for different files than restore asked for';

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

/* The URL if restore may GET it for `key`: https, a host name (no IP literal, not localhost), the expected origin when
   one is given, and a path whose decoded form ends in /<key>. Otherwise null. */
function linkFor(u, key, origin) {
  if (typeof u !== 'string' || u.length > 8192) return null;
  let p;
  try { p = new URL(u); } catch { return null; }
  if (p.protocol !== 'https:' || p.username || p.password) return null;
  const host = p.hostname.toLowerCase().replace(/\.$/, '');   // review 2: 'localhost.' is localhost
  if (host === 'localhost' || host.endsWith('.localhost') || host.startsWith('[') || /^[0-9.]+$/.test(host)) return null;
  if (origin && p.origin !== origin) return null;
  let path;
  try { path = decodeURIComponent(p.pathname); } catch { return null; }
  return path.endsWith(`/${key}`) ? u : null;
}

/* Why a grant answer cannot be used for this request, or null. */
function answerProblem(a, req, rec) {
  if (!a || typeof a !== 'object') return 'Kosmos+ sent back nothing restore can use';
  if (a.member !== req.member || String(a.epoch) !== req.epoch) return 'Kosmos+ answered for another member or key';
  const m = a.manifest;
  if (!m || m.key !== rec.key || m.sha256 !== rec.sha256 || (Number.isSafeInteger(rec.size) && m.size !== rec.size)) {
    return 'Kosmos+ answered for another backup';
  }
  const ml = linkFor(m.url, rec.key, null);
  if (!ml) return BAD_LINK;
  if (!Number.isSafeInteger(a.expires_at)) return 'Kosmos+ sent back links with no expiry';
  if (!Array.isArray(a.objects) || a.objects.length !== req.keys.length) return OTHER_FILES;
  const origin = new URL(ml).origin;
  const asked = new Set(req.keys);
  const seen = new Set();
  for (const o of a.objects) {
    if (!o || !asked.has(o.key) || seen.has(o.key)) return OTHER_FILES;
    if (!linkFor(o.url, o.key, origin)) return BAD_LINK;
    seen.add(o.key);
  }
  return null;
}

/* One GET, never thrown: { kind: 'bytes', bytes } | { kind: 'expired' } | { kind: 'retry' } | { kind: 'missing' }.
   retry (review 3): a 5xx, a 429, a dropped connection or the timeout, which another try may get past; missing: an
   answer that will not change (a 404, a refusal, a redirect, a body past maxBytes). A redirect is not followed, a body
   past maxBytes is cut off, and the read is aborted after timeoutMs. */
async function getOne(fetchFn, url, maxBytes, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetchFn(url, { method: 'GET', redirect: 'manual', signal: ac.signal });
    if (r.status !== 200) {
      let text = '';
      if (r.status === 403) { try { text = ((await readCapped(r, 8192)) || Buffer.alloc(0)).toString('utf8'); } catch { /* the code is optional */ } }
      else { try { await r.body?.cancel(); } catch { /* nothing to read */ } }
      // Only S3's presigned-url expiry, as engine/backupupload.js reads it for a PUT.
      if (r.status === 403 && /<Code>AccessDenied<\/Code>/.test(text) && /Request has expired/.test(text)) return { kind: 'expired' };
      return { kind: r.status >= 500 || r.status === 429 ? 'retry' : 'missing' };
    }
    const len = Number(r.headers && typeof r.headers.get === 'function' ? r.headers.get('content-length') : NaN);
    if (Number.isFinite(len) && len > maxBytes) { try { await r.body?.cancel(); } catch { /* not read */ } return { kind: 'missing' }; }
    const bytes = await readCapped(r, maxBytes);
    return bytes ? { kind: 'bytes', bytes } : { kind: 'missing' };
  } catch {
    return { kind: 'retry' };   // the connection, or the timeout's abort, mid-answer or mid-body
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
                       body is the route's { member, epoch, manifest, keys }; the caller makes the call. { ok: false }
                       is a refusal and stops the restore, so map only an answer that will not change to it (a 4xx,
                       a 429 included); a 5xx, a timeout or a dropped connection should throw, which reads as not
                       reached and is tried again (review 2). A grant gets grantTimeoutMs (default 15 s). The
                       reviewer route's 403 read_needs_release after the first grant means the release lapsed (the
                       header's 15 minutes): say so in `because`
     org, member, epoch   as the release names them (epoch as runRestore takes it)
     manifest             the coordinator's record: { key, period, sha256, size }
     fetch, now, sleep    globalThis.fetch, Date.now and setTimeout unless given; getTimeoutMs per GET (default 40 s)
   Returns { fetchObject(key, { maxBytes }) -> Buffer | null, plan(keys) -> promise of planned(), planned() ->
   { ok, because, unreadable, unreadableBecause } }. Never throws on what a grant or a store hands it. */
function readGrantFetcher(opts) {
  const grant = opts.grant;
  const fetchFn = opts.fetch || globalThis.fetch;
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const timeoutMs = Number.isSafeInteger(opts.getTimeoutMs) && opts.getTimeoutMs > 0 ? opts.getTimeoutMs : GET_TIMEOUT_MS;
  const manifestMs = Number.isSafeInteger(opts.manifestTimeoutMs) && opts.manifestTimeoutMs > 0 ? opts.manifestTimeoutMs : MANIFEST_GET_TIMEOUT_MS;
  const grantMs = Number.isSafeInteger(opts.grantTimeoutMs) && opts.grantTimeoutMs > 0 ? opts.grantTimeoutMs : GRANT_TIMEOUT_MS;
  const sleep = typeof opts.sleep === 'function' ? opts.sleep : (ms) => new Promise((r) => setTimeout(r, ms));
  const rec = opts.manifest || {};
  const ctx = { org: opts.org, member: opts.member, epoch: String(opts.epoch), period: rec.period };
  // review 5: the route reads the epoch as a number, so one past 2^53 would be sent wrong and its echo refused as
  // another key's. Refused by name instead, before any call.
  const epochProblem = !/^[1-9][0-9]*$/.test(ctx.epoch) ? 'restore was asked for this backup without a valid key epoch'
    : !Number.isSafeInteger(Number(ctx.epoch)) ? 'this backup\'s key epoch is larger than restore can ask Kosmos+ for' : null;
  const urls = new Map();   // key -> { url, expiresAtMs } (this computer's clock)
  const batchOf = new Map();   // key -> batch index
  const batches = [[]];   // batch 0 is the manifest alone (keys: [])
  const done = new Set();   // keys already fetched, never asked for again
  const inFlight = new Map();   // batch index -> promise
  let stopped = epochProblem;   // the reason every later fetch is refused
  let unreached = 0;
  const unreadable = new Map();   // key -> why it is not granted
  const problems = new Set();   // why some files could not be fetched, without stopping the rest (review 3)

  const fresh = (key) => { const u = urls.get(key); return u && now() < u.expiresAtMs - EXPIRY_MARGIN_MS ? u.url : null; };

  async function grantBatch(i, forKey) {
    if (stopped) return;
    if (inFlight.has(i)) return inFlight.get(i);
    const p = (async () => {
      if (typeof grant !== 'function') { stopped = 'restore has no way to ask Kosmos+ for its files'; return; }
      // Only what is still to come: a batch granted again does not hand out links for files already restored. The
      // route takes any 500 keys of the manifest, so a short call (a chunk a later file reuses, the tail of a batch)
      // is topped up with the next keys still to fetch, in plan order (review 3: a reused chunk spent a call alone).
      const keys = batches[i].filter((k) => k === forKey || (!done.has(k) && !fresh(k)));   // review 6: not a fresh one
      if (i > 0) {
        const have = new Set(keys);
        for (let j = i + 1; j < batches.length && keys.length < GRANT_KEYS; j += 1) {
          for (const k of batches[j]) {
            if (keys.length >= GRANT_KEYS) break;
            if (!have.has(k) && !done.has(k) && !fresh(k)) { keys.push(k); have.add(k); }
          }
        }
      }
      const body = { member: ctx.member, epoch: Number(ctx.epoch), manifest: rec.key, keys };
      const askedAt = now();
      let g, timer;
      try {
        // review 2: a grant that never answers (a stuck proxy, a connection left open across sleep) must not hang.
        const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve(undefined), grantMs); });
        g = await Promise.race([Promise.resolve().then(() => grant(body)), deadline]);
      } catch { g = undefined; } finally { clearTimeout(timer); }
      if (!g || typeof g !== 'object' || (g.ok !== true && g.ok !== false)) {
        unreached += 1;
        if (unreached >= MAX_UNREACHED) stopped = 'restore could not reach Kosmos+ to fetch this backup\'s files';
        return;
      }
      unreached = 0;   // review 2: misses count in a row, not over a whole long restore
      if (g.ok !== true) {
        // review 2: no "try again": a restore cannot yet pick up where it stopped, so a retry starts from the beginning.
        const limit = Number.isSafeInteger(g.retryAfterSecs) && g.retryAfterSecs > 0
          ? ` (Kosmos+ limits how much of a backup can be fetched in an hour, and a restore cannot yet continue where it stopped)` : '';
        stopped = `${(typeof g.because === 'string' && g.because) || 'Kosmos+ refused to hand out this backup\'s files'}${limit}`;
        return;
      }
      const why = answerProblem(g.answer, { member: ctx.member, epoch: ctx.epoch, keys }, rec);
      if (why) { stopped = why; return; }
      // From when it was asked for, on this clock: expires_at is the coordinator's clock, which this one cannot read.
      const expiresAtMs = askedAt + URL_LIFETIME_MS;
      urls.set(rec.key, { url: g.answer.manifest.url, expiresAtMs });
      for (const o of g.answer.objects) urls.set(o.key, { url: o.url, expiresAtMs });
    })();
    inFlight.set(i, p);
    try { await p; } finally { inFlight.delete(i); }
  }

  /* The chunk keys the opened manifest names, in the order restore will fetch them. Grants the first batch now. */
  async function plan(keys) {
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
    if (batches.length > 1 && !batches[1].some((k) => fresh(k))) await grantBatch(1, null);
    return planned();
  }

  function planned() {
    const why = [...new Set([...unreadable.values(), ...problems])];
    return { ok: !stopped, because: stopped || undefined, unreadable: [...unreadable.keys()], unreadableBecause: why };
  }

  async function fetchObject(key, o) {
    const maxBytes = o && Number.isSafeInteger(o.maxBytes) && o.maxBytes >= 0 ? o.maxBytes : 0;
    if (typeof fetchFn !== 'function') return null;
    let i;
    if (key === rec.key) i = 0;
    else if (batchOf.has(key)) i = batchOf.get(key);
    else return null;   // not planned, or unreadable (planned() says why)
    // At most two tries, each at most one grant and one GET, with one wait between: the worst path is 112 s (the
    // header's budget). A try is spent by a grant not reached, an expired link, or a GET worth trying again.
    let expired = 0, lastKind = null;
    const isManifest = key === rec.key;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0 && lastKind !== 'expired') await sleep(RETRY_WAIT_MS);
      if (!fresh(key)) await grantBatch(i, key);
      const url = fresh(key);
      if (!url) {
        if (stopped) return null;
        lastKind = 'unreached';
        continue;
      }
      const got = await getOne(fetchFn, url, maxBytes, isManifest ? manifestMs : timeoutMs);
      lastKind = got.kind;
      if (got.kind === 'bytes') { done.add(key); return got.bytes; }
      if (got.kind === 'missing' || isManifest) break;   // the manifest gets one GET, whatever it answered
      // expired: S3 says it lapsed while it looked fresh here (this clock slow, or a slow grant round trip).
      if (got.kind === 'expired') { expired += 1; urls.delete(key); }
    }
    // review 2: a link granted just now and already expired, twice, is the clocks, not this file: stop before every
    // other file spends the hour's grants the same way.
    if (expired === 2 && !stopped) stopped = LINKS_EXPIRED;
    if (lastKind === 'missing') {
      // review 6: named too, so a missing file is never headed by another file's reason
      if (!isManifest) problems.add('the storage service does not have some files');
      return null;
    }
    if (isManifest) {
      // review 5: the manifest is the first fetch, so it is where an outage or a wrong clock shows first: name it.
      if (lastKind === 'retry') problems.add('the storage service did not answer with this backup\'s manifest');
      if (lastKind === 'unreached') problems.add('restore could not reach Kosmos+ to fetch this backup\'s files');
      if (lastKind === 'expired') problems.add(LINKS_EXPIRED);   // a link granted moments ago
      return null;
    }
    if (lastKind === 'retry') problems.add('the storage service did not answer for some files');
    if (lastKind === 'unreached') problems.add('restore could not reach Kosmos+ for some files');   // review 4
    return null;
  }

  return { fetchObject, plan, planned };
}

module.exports = { readGrantFetcher, keyProblem, GRANT_KEYS, EXPIRY_MARGIN_MS, GET_TIMEOUT_MS, GRANT_TIMEOUT_MS, RETRY_WAIT_MS, MANIFEST_GET_TIMEOUT_MS, ANOTHER_EPOCH, BAD_LINK, OTHER_FILES, LINKS_EXPIRED };

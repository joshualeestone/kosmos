'use strict';

/**
 * Bringing the COLLECTED daily product-feedback reports back down for triage
 * (kosmos#2296, the collect -> triage bridge of the #2037/#2246 loop).
 *
 * The loop: engine/feedback.js authors a report locally -> engine/feedbacksend.js
 * transmits it (DEFAULT-ON / opt-out per #2013, secrets + home-paths scrubbed) -> the chaoskosmos-site
 * /api/feedback route (#97) stores it as JSON to @vercel/blob under an
 * UNGUESSABLE name (addRandomSuffix), enumerable only via the blob API + the
 * store token -> and engine/feedback-triage.js reads `.md` reports from a --dir.
 * NOTHING joined the last two: the blobs sit in the store and triage cannot see
 * them. THIS is that join. `pull` lists the feedback blobs, fetches each JSON
 * record, and writes it as a `.md` file (feedback.js's exact frontmatter+body
 * shape) into a directory `kosmos feedback triage --dir` then reads unchanged.
 *
 * 🔑 TOKEN VIA secrets-map, NOT env or a hard-coded path. The blob token is a
 * credential; it is read through `secrets-map.sh value <target>` so the map is
 * the single source of truth and the token never lands in argv or a repo. The
 * build is therefore NOT blocked on the token being provisioned: until it is
 * filed (target FEEDBACK_TOKEN_TARGET, via /add-secret), pull returns a clear
 * "token not filed" answer and writes nothing -- it starts working the moment
 * the token exists, with no code change.
 *
 * 🛑 READ-ONLY AGAINST THE STORE. pull only lists + GETs blobs; it never puts or
 * deletes. A malformed blob is skipped with a note, never written as a corrupt
 * report, and the write is write-then-rename so an interrupted pull cannot leave
 * a half-file a later triage treats as a real, truncated report.
 *
 * ⚠️ WEAKEST PREMISE: the Vercel Blob REST list shape (`GET <api>/?prefix=..`,
 * `Authorization: Bearer <token>`, `{ blobs: [{ url, pathname }], hasMore,
 * cursor }`), and a per-blob `url` read with the same Bearer token (the reports
 * are in a PRIVATE store since kosmos#3878). Built + hermetically tested against that
 * documented shape with an injectable transport; a live run once the token is
 * filed confirms or corrects the exact API, and the transport seam localises any
 * fix to one function.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const store = require('./store');

const DEFAULT_BLOB_API = 'https://blob.vercel-storage.com';
// Env-overridable so the real client (defaultList/defaultGet) is exercisable
// against a local stub in a test, and re-pointable if the store host changes.
const blobApi = () => process.env.AGENT_WORKFORCE_BLOB_API || DEFAULT_BLOB_API;
const PREFIX = 'feedback/';
// Bounds for the foreground network client: a per-request timeout (a hung GET
// must not block the command forever) and a page cap (a store that returned a
// non-terminating cursor must not loop forever / grow unbounded).
const REQUEST_TIMEOUT_MS = 15000;
const MAX_PAGES = 10000;

// fetch with a bounded timeout; every path clears the timer.
async function fetchBounded(url, init) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try { return await fetch(url, { ...(init || {}), signal: ctl.signal }); }
  finally { clearTimeout(timer); }
}
// The secrets-map target the blob token is filed under. Documented here and on
// kosmos#2296 so /add-secret files it under this exact name.
const FEEDBACK_TOKEN_TARGET = 'vercel-blob-feedback';
// Default landing dir for pulled reports, under the data root. Computed LAZILY
// (a function, not a const): store.ROOT is a lazy getter made lazy on purpose
// (store.js), so freezing it at module-load would re-introduce the frozen-root
// sandbox-leak hazard store.js documents -- a requirer that sets
// AGENT_WORKFORCE_DATA after this module loads would otherwise write to the real
// data root. feedback.js's dir() stays lazy for the same reason.
function defaultDir() { return path.join(store.ROOT, 'collected-feedback'); }

let transport = null; // tests inject { list: async(token)=>[{url,pathname}], get: async(url, token)=>text }
function setTransport(t) { transport = t; }

/**
 * The @vercel/blob read/write token, via the secrets map. Returns null (never
 * throws, never a partial) when the map, the tool, or the target is absent --
 * the caller turns that into a clear "not filed yet" answer. `value` is read
 * over a pipe (not a tty), which the accessor requires.
 */
function token() {
  // os.homedir() (NOT process.env.HOME): cross-platform, so this carries no
  // Windows-hostile env-home coupling. The pull command runs on the agent fleet
  // where the secrets map lives; a home that cannot be resolved just drops the
  // second candidate.
  let home = '';
  try { home = os.homedir() || ''; } catch { home = ''; }
  const bins = ['secrets-map.sh'];
  if (home) bins.push(path.join(home, '.local', 'bin', 'secrets-map.sh'));
  for (const bin of bins) {
    try {
      const out = execFileSync(bin, ['value', FEEDBACK_TOKEN_TARGET], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 8000,
      });
      const t = String(out || '').trim();
      if (t) return t;
    } catch { /* tool or target absent here; try the next candidate */ }
  }
  return null;
}

async function defaultList(tok) {
  const blobs = [];
  let cursor = null;
  let pages = 0;
  const seen = new Set();
  // Page through, so a large corpus is not truncated at the API's default limit.
  do {
    // A repeated or over-long cursor sequence is a misbehaving store, not more
    // data: stop rather than loop forever / grow unbounded.
    if (cursor && seen.has(cursor)) break;
    if (cursor) seen.add(cursor);
    if (++pages > MAX_PAGES) break;
    let url = blobApi() + '/?prefix=' + encodeURIComponent(PREFIX) + '&limit=1000';
    if (cursor) url += '&cursor=' + encodeURIComponent(cursor);
    const res = await fetchBounded(url, { headers: { authorization: 'Bearer ' + tok } });
    if (!res || !res.ok) throw new Error('blob list HTTP ' + (res && res.status));
    const j = await res.json();
    if (Array.isArray(j && j.blobs)) blobs.push(...j.blobs);
    cursor = j && j.hasMore ? j.cursor : null;
  } while (cursor);
  return blobs;
}

/* kosmos#3878: the reports now live in a PRIVATE blob store, where a blob URL
   answers 403 without the store token, so each GET carries it (the header
   @vercel/blob's own get() sends). The token goes only to an https Vercel Blob host
   (*.blob.vercel-storage.com, any store's: the check is Vercel-host scoped, not
   store scoped) or the configured blob API origin (whatever its scheme: that origin
   is operator-set, and the tests run it on http loopback). The URL comes from the
   listing, and a listing naming any other host must not receive the credential.
   Only the first hop is checked here; fetch itself drops Authorization on a
   cross-origin redirect. */
/* The Vercel Blob host, DERIVED from DEFAULT_BLOB_API so the security check and the
   API default cannot name two different domains. A report URL is on it when its
   host is that host or ends in "." + it (URL.hostname is already lower-cased). */
const BLOB_HOST = new URL(DEFAULT_BLOB_API).hostname;
function tokenMayGoTo(url) {
  try {
    const u = new URL(url);
    const h = u.hostname;
    if (u.protocol === 'https:' && (h === BLOB_HOST || h.endsWith('.' + BLOB_HOST))) return true;
    return u.origin === new URL(blobApi()).origin;
  } catch { return false; }
}

/* A read the store REFUSED (as opposed to missing, 404, or failing): 401 or 403 in the
   'blob GET HTTP <status>' errors defaultGet throws. One pattern, used for the count. */
const REFUSED_STATUS = /HTTP 40[13]\b/;

async function defaultGet(url, tok) {
  const send = !!(tok && tokenMayGoTo(url));
  const res = await fetchBounded(url, send ? { headers: { authorization: 'Bearer ' + tok } } : undefined);
  if (!res || !res.ok) {
    try { if (res && res.body && typeof res.body.cancel === 'function') await res.body.cancel(); } catch { /* release only */ }
    // A refusal after the token was WITHHELD is the host rule, not the token: say so,
    // so the hint below does not send anyone to refile a token that is fine.
    let host = '';
    try { host = new URL(url).hostname; } catch { host = '?'; }
    throw new Error('blob GET HTTP ' + (res && res.status) + (tok && !send ? ', token withheld from host ' + host : ''));
  }
  return res.text();
}

/** Reconstruct feedback.js's exact on-disk shape from a stored record, so triage
 *  reads a pulled report byte-compatibly with a locally-authored one. Header
 *  VALUES are single-lined: a newline in a stored field (generated_at is only
 *  length-capped server-side, not charset-filtered) must not shift the
 *  `---`...`---` boundary stripFrontmatter/frontmatterDate later find. The body
 *  is free-form below the header, so it is left as-is. */
function hdrValue(v) { return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim(); }
function toMarkdown(rec) {
  const header = [
    '---',
    'date: ' + (rec && rec.date ? hdrValue(rec.date) : ''),
    'install: ' + (rec && rec.install ? hdrValue(rec.install) : 'unknown'),
    'generated_at: ' + (rec && rec.generated_at ? hdrValue(rec.generated_at) : ''),
    '---',
    '',
  ].join('\n');
  return header + String(rec && rec.body == null ? '' : rec.body).replace(/\s*$/, '') + '\n';
}

/** A collision-free, human-legible filename. The date leads (so `ls` sorts by
 *  day) and the install disambiguates the many installs that share a day; the
 *  frontmatter still carries the real date, and triage's --dir now reads that as
 *  the date (a non-`YYYY-MM-DD.md` name), so `--since` still applies.
 *  🔑 (install, date) is a 1:1 key against the store: the collect route (#97)
 *  keeps ONE record per (install, date) -- it deletes the prior same-day blob
 *  when a re-send arrives -- so there is no PERSISTENT two-file collision. The
 *  only window with two same-(install,date) blobs is transient (the collect side
 *  writes-new-then-deletes-old); a pull caught in it picks one near-identical
 *  same-day revision by list order, and the next pull resolves to the survivor.
 *  generated_at is deliberately NOT in the name: adding it would break the
 *  idempotent per-(install,date) rewrite (a re-pull would pile up files). */
function fileName(rec) {
  const date = rec && /^\d{4}-\d{2}-\d{2}$/.test(rec.date) ? rec.date : 'undated';
  const inst = String((rec && rec.install) || 'unknown').replace(/[^\w.-]/g, '').slice(0, 64) || 'unknown';
  return date + '__' + inst + '.md';
}

/**
 * Pull every collected feedback report into `dir` as `.md` files triage reads.
 * Idempotent: a re-run rewrites the same per-(install,date) files rather than
 * duplicating. Returns a summary; never throws into the caller.
 */
async function pull(dir, opts) {
  const o = opts || {};
  const target = dir || defaultDir();
  const tp = transport || { list: defaultList, get: defaultGet };
  // An explicit `token` key (even '') skips resolution -- lets a test force the
  // not-filed path deterministically without depending on the machine's secrets
  // map. Absent key -> resolve via the map.
  const tok = Object.prototype.hasOwnProperty.call(o, 'token') ? o.token : token();
  if (!tok) {
    return {
      ok: false, written: 0, skipped: 0, dir: target,
      because: 'the collected-feedback token is not filed yet (secrets-map target "'
        + FEEDBACK_TOKEN_TARGET + '"). File it with /add-secret and re-run; nothing else changes.',
    };
  }
  let blobs;
  // The token IS present here (the not-filed case returned above), so a list
  // failure is a store/network/API fault, NOT a missing token -- surface the
  // underlying error so it is diagnosable instead of fail-softing to a generic
  // "0 reports" that reads like an empty store (kosmos#3060: a swallowed list
  // error is exactly what made this look like a fetch-path bug when it was not).
  try { blobs = await tp.list(tok); }
  catch (e) {
    return {
      ok: false, written: 0, skipped: 0, dir: target,
      because: 'the collected-feedback token is filed, but listing the store failed: '
        + String((e && e.message) || e) + '. This is a store/network/API fault, not a missing token.',
    };
  }
  try { fs.mkdirSync(target, { recursive: true }); }
  catch { return { ok: false, written: 0, skipped: 0, dir: target, because: 'could not create the destination directory' }; }
  let written = 0;
  let skipped = 0;
  // kosmos#3878: a GET that failed (403 from a private store read without the right
  // token, a network fault), counted apart from a malformed record, so a pull that
  // could read NOTHING is not reported as a success.
  let unreadable = 0;
  let lastGetError = '';
  // Reads refused although the token WAS sent. The listing came from this token's
  // store, so this is not a wrong store: the read path wants another URL or auth form.
  let denied = 0;
  for (const b of (Array.isArray(blobs) ? blobs : [])) {
    if (!b || typeof b.url !== 'string') { skipped += 1; continue; }
    let text;
    try { text = await tp.get(b.url, tok); }
    catch (e) {
      skipped += 1; unreadable += 1; lastGetError = String((e && e.message) || e);
      if (REFUSED_STATUS.test(lastGetError) && !/token withheld/.test(lastGetError)) denied += 1;
      continue;
    }
    let rec;
    try { rec = JSON.parse(text); }
    catch { skipped += 1; continue; }
    if (!rec || typeof rec !== 'object' || typeof rec.body !== 'string') { skipped += 1; continue; }
    try {
      const dest = path.join(target, fileName(rec));
      const tmp = dest + '.tmp';
      fs.writeFileSync(tmp, toMarkdown(rec));
      fs.renameSync(tmp, dest);
      written += 1;
    } catch { skipped += 1; }
  }
  const total = Array.isArray(blobs) ? blobs.length : 0;
  /* Whether the listing came from a PUBLIC blob store (<store>.public.<BLOB_HOST>, the
     shape @vercel/blob builds). Before kosmos#3878's migration that is correct; after
     it, it means the token filed as FEEDBACK_TOKEN_TARGET is still the old public
     store's. This file cannot tell which side of the migration it is on, so the note
     it drives is conditional (PUBLIC_STORE_NOTE). A stale public token AFTER the
     migration lists an empty store instead; that case is the zero-listed line in
     summaryLines, not this flag. */
  const fromPublicStore = (Array.isArray(blobs) ? blobs : []).some((b) => {
    try { return b && new URL(b.url).hostname.endsWith('.public.' + BLOB_HOST); } catch { return false; }
  });
  if (written === 0 && unreadable > 0) {
    return {
      ok: false, written, skipped, total, dir: target,
      because: 'the store listed ' + reports(total) + ' and none was pulled: ' + unreadable + ' could not be read'
        + (skipped > unreadable ? ', ' + (skipped - unreadable) + ' malformed or not written' : '')
        + ' (last read error: ' + lastGetError + ')'
        + (denied
          ? '. ' + denied + ' of them refused although this token was sent: the read path may need a different URL or auth form.'
          : '.')
        + (fromPublicStore ? ' ' + PUBLIC_STORE_NOTE : ''),
      unreadable, denied, fromPublicStore,
    };
  }
  // A partial pull is still ok, but says how many could not be read and why, so a
  // mostly-failed pull is not mistaken for a clean one.
  return { ok: true, written, skipped, unreadable, denied, lastGetError: unreadable ? lastGetError : '', fromPublicStore, total, dir: target };
}

/* The public-store hint, one wording for the success summary and the failure. It is
   conditional because before the site's private-store migration a public listing is
   correct, and only after it does it mean the token is stale. */
const PUBLIC_STORE_NOTE = 'These reports were listed from a PUBLIC blob store. That is expected until the site\'s '
  + 'private-store migration (kosmos#3878) has run; after it, refile ' + FEEDBACK_TOKEN_TARGET
  + ' with the private feedback store\'s token.';

/* A count with its noun, so a message never says "1 report(s)". */
function reports(n) { return n + (n === 1 ? ' report' : ' reports'); }

/**
 * The success summary of a pull, as lines. The ONE place it is worded: runCli, the
 * Mac `kosmos feedback pull` (install/kosmos) and the Windows command all print
 * these, so a partial pull's "could not be read" line cannot be missing from one of
 * them (kosmos#3878).
 */
function summaryLines(r) {
  const out = ['pulled ' + r.written + ' report(s)' + (r.skipped ? ' (' + r.skipped + ' skipped)' : '') + ' to ' + r.dir];
  // After the migration a stale public token lists an EMPTY store and reads cleanly,
  // so "pulled 0" alone would be the silent success this module refuses elsewhere.
  if (r.total === 0) {
    out.push('no reports were listed. If reports are expected, check that ' + FEEDBACK_TOKEN_TARGET
      + ' holds the private feedback store\'s token (kosmos#3878).');
  }
  if (r.unreadable) {
    out.push(r.unreadable + ' report(s) could not be read'
      + (r.denied ? ', ' + r.denied + ' of them refused although the token was sent' : '')
      + ' (last error: ' + r.lastGetError + ')');
  }
  if (r.fromPublicStore) out.push('note: ' + PUBLIC_STORE_NOTE);
  return out;
}

/**
 * CLI entrypoint, so `node engine/feedbackpull.js [--dir <path>]` actually pulls
 * the collected feedback into a triage-readable directory on ANY platform.
 *
 * 🛑 WHY THIS EXISTS (kosmos#3060). This module exported `pull` but nothing on
 * the fleet CALLED it: the feedback CLI verbs live only in the Windows AGENT's
 * command (tools/windows/kosmos-cli.js, `ctx.engine('feedbackpull').pull(...)`),
 * and the macOS `kosmos` launcher (install/kosmos) exposes none of them. So a
 * bare `node engine/feedbackpull.js <dir>` -- the obvious way to run it, and the
 * way #3060 was reproduced -- LOADED the module and invoked nothing, writing 0
 * reports with exit 0. That read as a fetch-path failure; it was a MISSING
 * ENTRYPOINT. `pull` itself is correct (its real-transport test pages + writes).
 * This mirrors the 12 sibling engine modules that carry a `require.main` block
 * and prints the same summary shape as the Windows CLI's `pull` verb.
 *
 * `opts` is forwarded to `pull` and exists only for the test seam (inject a
 * token so the CLI path is exercised without the real secrets map); the real
 * invocation below passes none, so `pull` resolves the token via the map exactly
 * as before. Accepts both `--dir <path>` (matches `kosmos feedback triage --dir`)
 * and a bare positional path (the #3060 repro), so both forms work.
 */
async function runCli(argv, opts) {
  const a = Array.isArray(argv) ? argv.slice() : [];
  let dir;
  while (a.length) {
    const t = a.shift();
    if (t === '--help' || t === '-h') {
      process.stdout.write('usage: node engine/feedbackpull.js [--dir <path>]\n'
        + 'Pulls collected feedback reports into <path> (default: the data root) as triage-readable .md files.\n');
      return 0;
    }
    if (t === '--dir') {
      // The directory can be given once, as EITHER `--dir <path>` OR a bare
      // positional -- giving it twice (any mix) is an error, symmetric with the
      // two-bare-positionals case below, so `--dir` never silently overwrites a
      // positional already seen.
      if (dir !== undefined) { process.stderr.write('the directory was given more than once\n'); return 2; }
      if (!a.length) { process.stderr.write('--dir needs a path\n'); return 2; }
      dir = a.shift();
    } else if (dir === undefined) {
      dir = t;
    } else {
      process.stderr.write('unexpected argument: ' + t + '\n');
      return 2;
    }
  }
  let r;
  try { r = await pull(dir || undefined, opts); }
  catch (e) { process.stderr.write('could not pull the collected feedback: ' + String((e && e.message) || e) + '\n'); return 1; }
  if (!r.ok) { process.stderr.write(r.because + '\n'); return 1; }
  for (const line of summaryLines(r)) process.stdout.write(line + '\n');
  return 0;
}

if (require.main === module) {
  // runCli catches its own only await today, but attach a rejection handler so a
  // future path that lets it reject surfaces as a clean stderr line + exit 1
  // rather than a raw unhandled rejection (matches selfcheck.js / win32update.js).
  runCli(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => { process.stderr.write('could not pull the collected feedback: ' + String((e && e.message) || e) + '\n'); process.exitCode = 1; });
}

module.exports = {
  pull, runCli, setTransport, token, toMarkdown, fileName,
  FEEDBACK_TOKEN_TARGET, PREFIX, defaultDir, blobApi, DEFAULT_BLOB_API,
  defaultList, defaultGet, tokenMayGoTo, summaryLines,
};

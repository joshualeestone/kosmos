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
 * shape) into a directory `kosmos feedback triage` then reads unchanged (with no
 * --dir when it is this default folder, #6265).
 *
 * 🔑 TOKEN VIA secrets-map, NOT env or a hard-coded path. The blob token is a
 * credential; it is read through `secrets-map.sh value <target>` so the map is
 * the single source of truth and the token never lands in argv or a repo. The
 * build is therefore NOT blocked on the token being provisioned: until it is
 * filed (target FEEDBACK_TOKEN_TARGET, via /add-secret), pull returns a clear
 * "token not filed" answer and writes nothing -- it starts working the moment
 * the token exists, with no code change. kosmos#8992: "not filed" is said only
 * when the map has no such target; a read that failed or timed out says to run
 * the pull again (tokenReading).
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
const { spawnSync } = require('node:child_process');
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
/* kosmos#9180: a pull fetched every report one at a time, and every one again on each pull, with nothing printed until
   the end (over a minute), so a caller with a timeout lost it silently. Now a few reports are fetched at once, a report
   already pulled into the folder is not fetched again (indexPath), and progress goes to the caller's onProgress. */
const FETCH_AT_ONCE = 6;
// The index lives under the data root, one per folder (by its resolved path), never in the folder, which holds reports only.
const INDEX_DIR = 'feedbackpull-index';
const PROGRESS_EVERY_MS = 3000;

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

/* How the secrets map is asked (tests inject one): (bin, args) -> { status, stdout, stderr, error } in the shape of
   child_process.spawnSync, with error.code 'ENOENT' when the tool is not there. */
let secretsRunner = null;
function setSecretsRunner(fn) { secretsRunner = typeof fn === 'function' ? fn : null; }
function runSecrets(bin, args) {
  if (secretsRunner) return secretsRunner(bin, args);
  return spawnSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 8000 });
}

/**
 * The @vercel/blob read/write token, via the secrets map: { token } when it was read, else { why, detail? } naming the
 * one next step that can help (kosmos#8992; before it every one of these read as "not filed yet", which told an agent
 * to run /add-secret over a working token). Never a throw.
 *   'missing'    the map has no such target, or no credential folder (lookup exits 1 saying "no credential mapped"
 *                or "no credential dir at"), and this process can read the whole folder: file it.
 *   'retry'      the read failed or timed out though the filing looks right (lookup shows one credential consumed by
 *                `value`), or the map did not answer at all: run the pull again; never file it.
 *   'misfiled'   the target is in the map but `value` cannot give it as filed (lookup shows BLOCKED, an env or path
 *                shape, an undeterminable shape, more than one credential, or a file this user cannot read): fix the
 *                filing or the file's mode; running again cannot help.
 *   'unreadable' the map says "no credential mapped" but this process cannot read the secrets folder or a file in it,
 *                so a missing target cannot be told from a hidden one: find those files (secrets-map.sh audit lists
 *                them) and fix their modes, or run where the folder can be read.
 *   'tool'       secrets-map.sh could not answer here: detail 'not-found', 'old' (no `value` verb) or 'cannot-start'.
 * The lookup's report is metadata only (where the file is, its format, whether it can be used), never a value, and
 * none of it reaches a message. `value` is read over a pipe (not a tty), which the accessor requires.
 */
function tokenReading() {
  // os.homedir() (NOT process.env.HOME): cross-platform, so this carries no
  // Windows-hostile env-home coupling. The pull command runs on the agent fleet
  // where the secrets map lives; a home that cannot be resolved just drops the
  // other candidates.
  let home = '';
  try { home = os.homedir() || ''; } catch { home = ''; }
  // On PATH, the usual link, and the fleet's own copy (what /agent-refresh installs), in that order.
  const bins = ['secrets-map.sh'];
  if (home) bins.push(path.join(home, '.local', 'bin', 'secrets-map.sh'), path.join(home, '.claude', 'scripts', 'secrets-map.sh'));
  let tool = 'not-found';   // why no place answered, if none does
  for (const bin of bins) {
    let got;
    try { got = runSecrets(bin, ['value', FEEDBACK_TOKEN_TARGET]); } catch { got = { error: new Error('could not run') }; }
    if (got && got.error && got.error.code === 'ENOENT') continue;   // not at this place; try the next
    const t = String((got && got.stdout) || '').trim();
    if (got && !got.error && got.status === 0 && t) return { token: t };
    /* A copy that could not be started (not executable, or refused, as in a sandbox) or that does not know the verb
       (it says "unknown subcommand 'value'") is not this place's answer: the next place may work, as it did before
       #8992. Any other exit 2 is the verb refusing a filed credential's shape (an env file, say), which the lookup
       below names. A timeout does answer here, so a hung tool costs one read and one lookup at this place (a broken
       first copy that is also slow adds the next place's wait). A non-zero exit never yields a token, even with
       something on stdout: an old copy's own pipe can exit 141 after printing it. */
    const timedOut = Boolean(got && got.error && got.error.code === 'ETIMEDOUT');
    if (got && got.error && !timedOut) { if (tool === 'not-found') tool = 'cannot-start'; continue; }
    if (got && !got.error && got.status === 2 && /unknown subcommand 'value'/.test(String(got.stderr || ''))) { tool = 'old'; continue; }
    // The tool is here and did not give the token: ask the map whether the target is in it, and in what state.
    let seen;
    try { seen = runSecrets(bin, ['lookup', FEEDBACK_TOKEN_TARGET]); } catch { seen = { error: new Error('could not run') }; }
    if (seen && !seen.error && seen.status === 0) {
      /* Only one credential whose report says to consume it with `value` is one a read can give, so its failure is
         passing. Anything else (BLOCKED, a file this user cannot read, an env or path shape, an undeterminable shape,
         two credentials) is a filing `value` refuses every time. */
      const report = String(seen.stdout || '');
      const creds = (report.match(/^cred:/gm) || []).length;
      const esc = FEEDBACK_TOKEN_TARGET.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const byValue = new RegExp('^consume:\\s*secrets-map\\.sh value ' + esc + '\\s*$', 'm');
      return { why: creds === 1 && byValue.test(report) ? 'retry' : 'misfiled' };
    }
    const said = String((seen && seen.stderr) || '');
    if (seen && !seen.error && seen.status === 1 && /no credential (mapped|dir at)/i.test(said)) {
      // A folder or file this process cannot read gives the same answer as a missing target: say which it is.
      return { why: secretsReadable() ? 'missing' : 'unreadable' };
    }
    return { why: 'retry' };   // the map did not answer the lookup either
  }
  return { why: 'tool', detail: tool };
}

/* Can this process read the secrets folder and every file that can hold a credential's metadata? By mode only (a
   listing and an access check, never a file's content; macOS privacy refusals can still deny a read this passes).
   Skipped, as secrets-map.sh's is_cred_file skips them (a hand copy of its rule: keep the two in step): its README,
   *.example, dotfiles and backups (*.bak, *.old, *.orig, *~); also folders and a link whose target is gone (nothing to
   read). NOT skipped, unlike is_cred_file: *.meta sidecars, since an unreadable sidecar hides its target just as an
   unreadable credential does. Only a refusal (EACCES, EPERM) counts. A folder that does not exist is readable in this
   sense: nothing is filed there. */
const NOT_A_CRED = /^(README\.md|\..*|.*\.example|.*\.bak|.*\.old|.*\.orig|.*~)$/;
function secretsReadable() {
  let home = '';
  try { home = os.homedir() || ''; } catch { home = ''; }
  const dir = process.env.SECRETS_DIR || (home ? path.join(home, '.config', 'secrets') : '');
  if (!dir) return true;
  const refused = (e) => Boolean(e && (e.code === 'EACCES' || e.code === 'EPERM'));
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return !refused(e); }
  for (const n of names) {
    if (NOT_A_CRED.test(n)) continue;
    const f = path.join(dir, n);
    let st;
    try { st = fs.statSync(f); } catch (e) { if (refused(e)) return false; continue; }   // a dangling link: skipped
    if (!st.isFile()) continue;
    try { fs.accessSync(f, fs.constants.R_OK); } catch (e) { if (refused(e)) return false; }
  }
  return true;
}

// What a pull says when it has no token, by tokenReading's answer. Only 'missing' says to file it.
function noTokenBecause(read) {
  const t = 'secrets-map target "' + FEEDBACK_TOKEN_TARGET + '"';
  const look = '`secrets-map.sh lookup ' + FEEDBACK_TOKEN_TARGET + '`';
  const why = read && read.why;
  if (why === 'retry') return 'the collected-feedback token could not be read just now (' + t + '). Run the pull again; do not file it. If it keeps failing, ' + look + ' shows whether it is filed: file it only if that says it is missing, and if it shows it filed, the secrets map is slow or busy here, or old (run /agent-refresh), or the filed token file is empty.';
  if (why === 'misfiled') return 'the collected-feedback token is filed (' + t + ') but the secrets map cannot give it as filed: ' + look + ' shows why (a file this user cannot read, a shape other than a bare token, or more than one credential for it). Fix the file\'s mode or owner, or the filing with /add-secret; running the pull again will not help.';
  if (why === 'unreadable') return 'this process cannot read the secrets folder, or a file in it, so whether the collected-feedback token is filed (' + t + ') cannot be told. `secrets-map.sh audit` lists the files it cannot read: fix their mode or owner, or run the pull where the folder can be read. Do not file it until then.';
  if (why === 'tool') {
    const what = read.detail === 'old' ? 'is an old copy without `value`' : read.detail === 'cannot-start' ? 'could not be started here (not executable, or refused, as from inside a sandbox)' : 'was not found (on PATH, in ~/.local/bin or in ~/.claude/scripts)';
    return 'secrets-map.sh ' + what + ', so the collected-feedback token (' + t + ') cannot be read. ' + (read.detail === 'cannot-start' ? 'Run the pull where it can run, or' : 'Install or update it with /agent-refresh, or') + ' check it by hand; do not file the token.';
  }
  return 'the collected-feedback token is not filed yet (' + t + '). File it with /add-secret and re-run; nothing else changes. If you believe it is filed, run `secrets-map.sh audit` first: a credential whose header cannot be read looks unfiled.';
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

/* kosmos#6265: the line a pull ends with. The default folder is what a plain `kosmos feedback triage` reads. */
function nextLine(dir, platform = process.platform) {
  /* Review 5/6: triage's own comparison (feedback.samePath: the OS's spelling, case folded on Windows), and a path
     quoted when it holds anything but plain path characters, so the line can be pasted. */
  if (!dir || require('./feedback').samePath(dir, defaultDir())) return 'next: kosmos feedback triage';
  /* Review 6/7: anything beyond plain path characters is single-quoted for the shell that will read it: on Windows
     PowerShell (an inner ' doubled; a backslash is a plain path character there), elsewhere a POSIX shell (an inner '
     closed and reopened; a backslash is quoted, since bash would drop it). */
  return 'next: kosmos feedback triage --dir ' + require('./feedback').shellArg(dir, platform);
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
  const read = Object.prototype.hasOwnProperty.call(o, 'token') ? { token: o.token, why: 'missing' } : tokenReading();
  const tok = read.token;
  if (!tok) {
    // kosmos#8992: only a target the map does not have is "not filed"; every other answer names its own next step.
    return { ok: false, written: 0, skipped: 0, dir: target, why: read.why, because: noTokenBecause(read) };
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
  // store, so this is not a wrong store; the read path may need another URL or auth
  // form, or the token may lack read access (the message says "may").
  let denied = 0;
  // kosmos#3906: a report read fine but not saved on THIS computer (a full disk, a
  // permission, a directory in the way), counted apart from a bad record so the
  // message points at the local disk, with the error.
  let unwritten = 0;
  let lastWriteError = '';
  /* kosmos#9180: what this folder already holds, by store object. A re-sent report is a NEW object (the collect route
     writes a new blob and deletes the old one), and the key carries its upload time and size too, so a changed report is
     never taken for one already here. A report is skipped only while the file it was saved as is still in the folder;
     `all` fetches everything again. An index that cannot be read is an empty one: the cost is one full pull. */
  const listed = Array.isArray(blobs) ? blobs : [];
  const before = o.all === true ? {} : readIndex(target);
  const index = {};
  let alreadyHere = 0;
  const toFetch = [];
  for (const b of listed) {
    const key = indexKey(b);
    const had = key && Object.prototype.hasOwnProperty.call(before, key) ? before[key] : null;
    if (had && isSavedName(had) && fs.existsSync(path.join(target, had))) { index[key] = had; alreadyHere += 1; continue; }
    toFetch.push(b);
  }
  /* Review 1: with nothing to fetch, no read would happen at all, so a token that can no longer READ the store would
     pass as a success. One report is read back as a check, and a refused read fails the pull as before. */
  if (!toFetch.length && listed.length) {
    const probe = listed.find((b) => b && typeof b.url === 'string');
    if (probe) {
      try { await tp.get(probe.url, tok); }
      catch (e) {
        const why = String((e && e.message) || e);
        return { ok: false, written: 0, alreadyHere, skipped: 0, dir: target,
          because: 'every listed report is already in ' + target + ', but reading one back to check the token failed: ' + why
            + (REFUSED_STATUS.test(why) ? '. The token may no longer have read access to the store.' : '.') };
      }
    }
  }
  /* A few at a time, each result kept in its list place, then written IN LIST ORDER below, so two same-day blobs of one
     install (the collect route's brief write-then-delete window) resolve exactly as the one-at-a-time loop did. */
  const progress = typeof o.onProgress === 'function' ? o.onProgress : null;
  const fetched = new Array(toFetch.length);
  let done = 0;
  let lastSaid = Date.now();
  let next = 0;
  const every = Number.isFinite(o.progressEveryMs) && o.progressEveryMs >= 0 ? o.progressEveryMs : PROGRESS_EVERY_MS;   // tests set it
  const say = () => { try { progress({ fetched: done, toFetch: toFetch.length, alreadyHere, total: listed.length }); } catch { /* a progress line never fails a pull */ } };
  if (progress && toFetch.length) say();   // at once: the pull lives, and says how much it has to fetch
  const worker = async () => {
    while (next < toFetch.length) {
      const i = next++;
      const b = toFetch[i];
      if (!b || typeof b.url !== 'string') { fetched[i] = { bad: true }; }
      else {
        try { fetched[i] = { text: await tp.get(b.url, tok) }; }
        catch (e) { fetched[i] = { error: String((e && e.message) || e) }; }
      }
      done += 1;
      if (progress && done < toFetch.length && Date.now() - lastSaid >= every) { lastSaid = Date.now(); say(); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(FETCH_AT_ONCE, toFetch.length) }, worker));
  for (let i = 0; i < toFetch.length; i++) {
    const b = toFetch[i];
    const got = fetched[i];
    if (got.bad) { skipped += 1; continue; }
    if (got.error !== undefined) {
      skipped += 1; unreadable += 1; lastGetError = got.error;
      if (REFUSED_STATUS.test(lastGetError) && !/token withheld/.test(lastGetError)) denied += 1;
      continue;
    }
    const text = got.text;
    let rec;
    try { rec = JSON.parse(text); }
    catch { skipped += 1; continue; }
    if (!rec || typeof rec !== 'object' || typeof rec.body !== 'string') { skipped += 1; continue; }
    const dest = path.join(target, fileName(rec));
    try {
      /* #5434 slice 24: flushed before the rename (a crash cannot leave a pulled report zero-filled, #5431). The temp
         is securewrite's own unique `wx` name, removed on failure, so a concurrent pull's temp is never touched (what
         the old "only a .tmp this call wrote" rule protected). ownTempsOnly: `dir` can be any folder the caller names,
         so only this report's own dead temps are reaped there; the mode is the umask default, as before. */
      require('./securewrite').writeSecret(dest, toMarkdown(rec), null, { atomicOnly: true, ownTempsOnly: true, umaskDefault: true });
      written += 1;
      /* Review 1: the file now holds THIS report, so no other store object may stay indexed as saved in it. Two same-day
         objects of one install write one file; without this the one written FIRST stayed indexed, and once the other was
         deleted from the store it was skipped for ever with the wrong content in the file. */
      const name = path.basename(dest);
      for (const k of Object.keys(index)) if (index[k] === name) delete index[k];
      const key = indexKey(b);
      if (key) index[key] = name;
    } catch (e) {
      // The code and the report's own name, not the raw message, which would name securewrite's long internal temp path.
      skipped += 1; unwritten += 1; lastWriteError = ((e && e.code) || 'error') + ' saving ' + path.basename(dest);
    }
  }
  const total = listed.length;
  // Only what the store still lists is kept, so the index never outgrows the store. A failed save costs a re-fetch next time.
  writeIndex(target, index);
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
  // Every skip took exactly one branch above, so what is left is the malformed ones
  // (no url, not JSON, the wrong shape). Counted ONCE, here, for both results.
  const malformed = skipped - unreadable - unwritten;
  const counts = { written, alreadyHere, skipped, unreadable, denied, lastGetError: unreadable ? lastGetError : '',
    unwritten, lastWriteError: unwritten ? lastWriteError : '', malformed, fromPublicStore, total, dir: target };
  /* kosmos#3906: the store listed reports and NONE was pulled, whether they could not
     be read (#3878), were malformed, or failed to save here. Any of those is a failure
     with its reasons, never "pulled 0" as a success. */
  /* Review 1: reports already here do not turn a pull whose every READ failed into a success; only malformed reports
     beside ones already here do not fail it (those are the store's, not this pull's, fault). */
  if (written === 0 && skipped > 0 && (alreadyHere === 0 || unreadable > 0 || unwritten > 0)) {
    return { ok: false, ...counts,
      because: 'the store listed ' + reports(total) + ' and none was pulled' + (alreadyHere ? ' (' + alreadyHere + ' already here)' : '') + ': ' + reasonClauses(counts).join('; ')
        + '.' + (fromPublicStore ? ' ' + PUBLIC_STORE_NOTE : '') };
  }
  // A partial pull is still ok, and its summary gives the same reasons for every skip.
  return { ok: true, ...counts };
}

/* kosmos#9180: a folder's index of what is already pulled, { "<store path>|<uploaded>|<size>": "<file name>" }. */
function indexKey(b) {
  /* Only a listing that says WHEN the object was uploaded can be skipped: without it, a store that rewrote one path in
     place would look unchanged, so such a report is always fetched (as before #9180). Vercel Blob lists uploadedAt. */
  if (!b || typeof b !== 'object' || typeof b.uploadedAt !== 'string' || !b.uploadedAt) return '';
  const where = typeof b.pathname === 'string' && b.pathname ? b.pathname : (typeof b.url === 'string' ? b.url : '');
  return where ? where + '|' + b.uploadedAt + '|' + String(b.size == null ? '' : b.size) : '';
}
// A name fileName could have made, so an index someone edited cannot point the existence check outside the folder.
function isSavedName(n) { return typeof n === 'string' && /^[\w.-]+\.md$/.test(n) && n === path.basename(n) && !n.startsWith('.'); }
function indexPath(dir) {
  const id = require('node:crypto').createHash('sha256').update(path.resolve(dir)).digest('hex').slice(0, 32);
  return path.join(store.ROOT, INDEX_DIR, id + '.json');
}
function readIndex(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(indexPath(dir), 'utf8'));
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  } catch { return {}; }
}
function writeIndex(dir, index) {
  try {
    // Review 1: private (0700 folder, owner-only file): it lists store paths and install ids.
    fs.mkdirSync(path.dirname(indexPath(dir)), { recursive: true, mode: 0o700 });
    require('./securewrite').writeSecret(indexPath(dir), JSON.stringify(index) + '\n', 0o600, { atomicOnly: true, ownTempsOnly: true });
  }
  catch { /* the reports are saved; without the index the next pull fetches them again */ }
}
/* kosmos#9180: the progress line the three callers print on stderr (the summary stays on stdout). */
function progressLine(p) {
  return 'pulling feedback: ' + p.fetched + ' of ' + p.toFetch + ' fetched' + (p.alreadyHere ? ' (' + p.alreadyHere + ' already here)' : '') + '...';
}

/* The public-store hint, one wording for the success summary and the failure. It is
   conditional because before the site's private-store migration a public listing is
   correct, and only after it does it mean the token is stale. */
const PUBLIC_STORE_NOTE = 'These reports were listed from a PUBLIC blob store. That is expected until the site\'s '
  + 'private-store migration (kosmos#3878) has run; after it, refile ' + FEEDBACK_TOKEN_TARGET
  + ' with the private feedback store\'s token.';

/* A count with its noun: "1 report", "2 reports". */
function reports(n) { return n + (n === 1 ? ' report' : ' reports'); }

/* The one wording of "some reports could not be read", for the failure message and
   the success summary alike. `denied` = refused although the token was sent. */
function unreadableClause({ unreadable, denied, lastGetError }) {
  return reports(unreadable) + ' could not be read'
    + (denied ? ', ' + denied + ' of them refused although the token was sent (the read path may need a different URL or auth form)' : '')
    + ' (last error: ' + lastGetError + ')';
}

/* The one wording of "some reports could not be saved here" (a local write failure,
   kosmos#3906), for the failure message and the success summary alike. */
function unwrittenClause({ unwritten, lastWriteError, dir }) {
  return reports(unwritten) + ' could not be saved in ' + dir + ' (last error: ' + lastWriteError + ')';
}

/* Why reports were skipped, one clause per kind that applies, in one wording for the
   failure message (joined) and the success summary (one line each). */
function reasonClauses(r) {
  const out = [];
  if (r.unreadable) out.push(unreadableClause(r));
  if (r.unwritten) out.push(unwrittenClause({ unwritten: r.unwritten, lastWriteError: r.lastWriteError, dir: r.dir }));
  if (r.malformed) out.push(reports(r.malformed) + ' malformed (not a valid report, or no url)');
  return out;
}

/**
 * The success summary of a pull, as lines. The ONE place it is worded: runCli, the
 * Mac `kosmos feedback pull` (install/kosmos) and the Windows command all print
 * these, so a partial pull's "could not be read" line cannot be missing from one of
 * them (kosmos#3878).
 */
function summaryLines(r) {
  const out = ['pulled ' + r.written + ' report(s)' + (r.alreadyHere ? ', ' + r.alreadyHere + ' already here' : '') + (r.skipped ? ' (' + r.skipped + ' skipped)' : '') + ' to ' + r.dir];
  // After the migration a stale public token lists an EMPTY store and reads cleanly,
  // so "pulled 0" alone would be the silent success this module refuses elsewhere.
  if (r.total === 0) {
    out.push('no reports were listed. If reports are expected, check that ' + FEEDBACK_TOKEN_TARGET
      + ' holds the private feedback store\'s token (kosmos#3878).');
  }
  out.push(...reasonClauses(r));
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
  let all = false;
  while (a.length) {
    const t = a.shift();
    if (t === '--all') { all = true; continue; }   // kosmos#9180
    if (t === '--help' || t === '-h') {
      process.stdout.write('usage: node engine/feedbackpull.js [--dir <path>] [--all]\n'
        + 'Pulls collected feedback reports into <path> (default: collected-feedback under the data root, which triage reads with no --dir) as triage-readable .md files.\n'
        + 'Reports already pulled into <path> are not fetched again; --all fetches every one.\n');
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
  try { r = await pull(dir || undefined, { onProgress: (p) => process.stderr.write(progressLine(p) + '\n'), ...(opts || {}), ...(all ? { all: true } : {}) }); }
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
  pull, runCli, setTransport, setSecretsRunner, tokenReading, noTokenBecause, toMarkdown, fileName,
  FEEDBACK_TOKEN_TARGET, PREFIX, defaultDir, nextLine, blobApi, DEFAULT_BLOB_API,
  defaultList, defaultGet, tokenMayGoTo, summaryLines, progressLine, indexPath, FETCH_AT_ONCE,
};

'use strict';
/**
 * #3939: Meta's Muse Code as a Kosmos runner, first slice: is it on this computer, and which version.
 * Nothing here signs in, starts a session or writes anything.
 *
 * Measured on the Mortals Mac (2026-09-26, card #3939): Meta's installer puts a launcher at
 * ~/.local/bin/muse, and `muse --version` prints "Muse Code 1.4.0 (1.4.0-R4161.1)" and writes nothing.
 * (`muse exec`, not used here, creates a register in the REAL ~/Library/Application Support/Muse
 * whatever HOME says: so this module never overrides HOME, and later slices must not rely on it.)
 *
 * The version read runs the binary, so it goes through the live-execution gate (CLAUDE.md
 * convention 3) and has a timeout; an answer that does not look like Muse Code is "unknown",
 * never a guessed version.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const runners = require('./runners');

/* `muse --version` answers at once; this long means something is wrong with the binary. */
const VERSION_TIMEOUT_MS = 10000;
/* Round 1: our own backstop, in case the child outlives even SIGKILL's wait (a wedged process); the
   answer is "unknown" and any late callback is ignored (the agystatus pattern). */
const VERSION_HARD_CAP_MS = VERSION_TIMEOUT_MS + 5000;
/* --version prints one short line; anything much longer is not it. */
const VERSION_MAX_BUFFER = 64 * 1024;
/* "Muse Code 1.4.0 (1.4.0-R4161.1)": the product name, the version, and the build in brackets. The
   WHOLE trimmed output must be that line (round 1): a banner around it is not a version. */
const VERSION_RE = /^Muse Code (\d+\.\d+\.\d+)(?: \(([^)\s]+)\))?$/;
const VERSION_UNKNOWN_BECAUSE = 'Kosmos could not read which Muse Code this is';
const NOT_INSTALLED_BECAUSE = 'Muse Code is not on this computer';
const CHECK_FAILED_BECAUSE = 'Kosmos could not check for Muse Code';
/* The one command this module runs; the refusal message and the run both use it (round 3). */
const VERSION_ARGS = Object.freeze(['--version']);

/** { installed, bin, because }: cheap (a file check), safe on every render. */
function installed() {
  const r = runners.resolveBin('muse');
  const present = !!(r && r.present);
  // One derivation of the reason (round 3): a missing file says so, here, for every reader.
  return { installed: present, bin: r ? r.bin : null, because: present ? null : ((r && r.because) || NOT_INSTALLED_BECAUSE) };
}

/** The version from `muse --version`'s text, or null when it is not Muse Code's line. */
function parseVersion(text) {
  const m = VERSION_RE.exec(String(text || '').trim());
  return m ? { version: m[1], build: m[2] || null } : null;
}

let runVersion = (bin, done) => {
  const gate = require('./live-execution');
  if (!gate.liveExecutionAllowed()) { gate.refuseOrWarn('musestatus', bin, VERSION_ARGS.slice()); done(new Error('live execution is off')); return; }
  // SIGKILL, not the default SIGTERM (round 1): a launcher script that ignores TERM kept the answer waiting 25 s.
  execFile(bin, VERSION_ARGS.slice(), { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: VERSION_MAX_BUFFER, encoding: 'utf8' },
    (err, stdout) => done(err, stdout));
};

/** Promise of { installed, version, build, because }: never rejects. */
function version() {
  return new Promise((resolve) => {
    // Inside a try too (round 2): "never rejects" holds by construction, not because resolveBin cannot throw today.
    let inst;
    // Unknown, not "not installed" (round 3): the check itself failed.
    try { inst = installed(); } catch { resolve({ installed: null, version: null, build: null, because: CHECK_FAILED_BECAUSE }); return; }
    if (!inst.installed) { resolve({ installed: false, version: null, build: null, because: inst.because }); return; }
    const unknown = { installed: true, version: null, build: null, because: VERSION_UNKNOWN_BECAUSE };
    let settled = false;
    const finish = (answer) => { if (settled) return; settled = true; clearTimeout(cap); resolve(answer); };
    const cap = setTimeout(() => finish(unknown), hardCapMs);
    if (cap.unref) cap.unref();
    try {
      runVersion(inst.bin, (err, out) => {
        const v = err ? null : parseVersion(out);
        finish(v ? { installed: true, version: v.version, build: v.build, because: null } : unknown);
      });
    } catch {
      finish(unknown);
    }
  });
}

/* ---- #3939 slice 3: the flag and the sign-in -------------------------------------------------- */

/** Whether Meta Muse shows anywhere: AGENT_WORKFORCE_MUSE=1, on a Mac (the only platform the runner
    is built for). Off by default, so every screen is as before until someone turns it on. */
function enabled(platform = process.platform) {
  return process.env.AGENT_WORKFORCE_MUSE === '1' && platform === 'darwin';
}

/* The mark Kosmos leaves when ITS sign-in ended "Logged in." (engine/musesignin.js writes it). On a
   Mac, Muse keeps the sign-in in the login Keychain, which Kosmos never reads: an item named "meta"
   could be anybody's. */
function signinFolder() { return path.join(require('./store').ROOT, 'muse-signin'); }   // the sign-in's folder, and its mark's
function signedInMarker() { return path.join(signinFolder(), 'signed-in.json'); }
/* #3939 slice 3c-1: what Kosmos has SEEN about the credential, as APPEND-ONLY EVENTS (review round 6).
   Several boards on one Mac share this folder, so any read-decide-write can interleave with another
   process. Nothing here reads a record and then rewrites or deletes it: every observation is its own
   file, created once, and the answer is a pure read that takes the latest of each kind. A write that
   lands late or out of order is simply not the latest, so no interleaving can lose a newer fact.
   - A MARK: Muse worked. Its time is when that was known to be true: a completed turn's START (it
     proves the credential it began with), or the moment Kosmos's own sign-in finished.
   - A NOTE: Muse refused. Its time is the refused turn's START, and it keeps a canonical digest of
     Muse's own auth.json meta entry as it was when that turn STARTED (never the entry), plus whether
     the file could be read then.
   The latest mark against the latest note decides; a tie is signed out, the safe direction.
   Times are integers from Date.now() in the event's NAME, never file mtimes (those keep fractions of a
   millisecond that Date.now() drops, round 3). The signed-in.json of slice 3a is read as one more mark. */
function eventsFolder() { return path.join(signinFolder(), 'events'); }
const EVENT_NAME = /^(\d{15})-(mark|note)-[a-z0-9.]+\.json$/;
/* Canonical: keys sorted at every depth, so the same credential written in another key order is the
   same credential (review round 2). */
const canonical = (v) => (Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']'
  : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}'
  : JSON.stringify(v));
const metaDigest = (meta) => crypto.createHash('sha256').update(canonical(meta)).digest('hex');
/* { meta, unread }: the meta entry, or null when there is none. `unread` when the file is there but
   could not be read or parsed (permissions, or Muse part-way through rewriting it): not the same as
   "no entry" (round 3). */
function readMeta() {
  let text;
  try { text = fs.readFileSync(authFile(), 'utf8'); } catch (e) { return { meta: null, unread: !(e && e.code === 'ENOENT') }; }
  try {
    const j = JSON.parse(text);
    const meta = j && j.providers && j.providers.meta;
    // Present and not empty: `muse logout` leaves {"providers":{}}.
    return { meta: meta && typeof meta === 'object' && Object.keys(meta).length ? meta : null, unread: false };
  } catch { return { meta: null, unread: true }; }
}
/** What Muse's own file holds, as a note records it: taken when a turn STARTS, because a refusal is
    about the credential the turn began with (round 5: a `muse login` or `logout` during the turn). */
function fileAtStart() {
  const { meta, unread } = readMeta();
  return { metaDigest: meta ? metaDigest(meta) : null, fileUnread: unread };
}

/* The latest event of each kind: { mark: at | null, note: { at, metaDigest, fileUnread } | null }.
   A note whose body cannot be read keeps its time (from its name) and fails closed for Muse's file
   (fileUnread): it can never make the file answer yes. */
function latest() {
  let mark = null; let note = null; let noteName = null;
  let names = [];
  try { names = fs.readdirSync(eventsFolder()); } catch { /* no events yet */ }
  for (const n of names) {
    const m = EVENT_NAME.exec(n);
    if (!m) continue;
    const at = Number(m[1]);
    if (m[2] === 'mark') { if (mark === null || at > mark) mark = at; }
    else if (note === null || at > note.at || (at === note.at && n > noteName)) { note = { at }; noteName = n; }
  }
  // Slice 3a's single mark file, read as one more mark (an ISO or integer `at`, else its mtime).
  try {
    const st = fs.statSync(signedInMarker());
    let at;
    try { const j = JSON.parse(fs.readFileSync(signedInMarker(), 'utf8')); at = typeof j.at === 'string' ? Date.parse(j.at) : j.at; } catch { at = undefined; }
    if (typeof at !== 'number' || !Number.isFinite(at)) at = Math.floor(st.mtimeMs);
    if (st.isFile() && (mark === null || at > mark)) mark = at;
  } catch { /* none */ }
  if (note) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(eventsFolder(), noteName), 'utf8'));
      note.metaDigest = typeof j.metaDigest === 'string' ? j.metaDigest : null;
      note.fileUnread = j.fileUnread === true;
    } catch { note.metaDigest = null; note.fileUnread = true; }
  }
  return { mark, note };
}

/* One new event file, created by rename so no reader ever sees half of one. Then, best effort, older
   events of the same kind are removed: an event older than the newest of its kind never decides
   anything, so removing it cannot change the answer, whatever another process does meanwhile. */
function record(kind, at, body) {
  const dir = eventsFolder();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const name = String(at).padStart(15, '0') + '-' + kind + '-' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.json';
  const tmp = path.join(dir, '.' + name + '.tmp');
  try {
    fs.writeFileSync(tmp, JSON.stringify(body) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, path.join(dir, name));
  } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* none */ } throw e; }
  try {
    const mine = fs.readdirSync(dir).map((n) => EVENT_NAME.exec(n)).filter((m) => m && m[2] === kind);
    const newest = Math.max(...mine.map((m) => Number(m[1])));
    for (const m of mine) if (Number(m[1]) < newest) fs.rmSync(path.join(dir, m[0]), { force: true });
  } catch { /* pruning is housekeeping; the answer never depends on it */ }
}

/** Record that Muse refused the credential for a turn that STARTED at `startedAt` (ms), with Muse's
    file as it was then (`atStart`, from fileAtStart). Writes nothing when a later event already
    decides (a sign-in that finished while the turn ran, round 1; a newer refusal, round 4). True when
    it wrote. Never throws. */
function markSignedOut(startedAt = Date.now(), atStart = null) {
  try {
    const now = latest();
    if (now.mark !== null && now.mark > startedAt) return false;
    if (now.note && now.note.at > startedAt) return false;
    const file = atStart || fileAtStart();
    record('note', startedAt, { metaDigest: file.metaDigest, fileUnread: file.fileUnread });
    return true;
  } catch { return false; }
}
/** A completed turn that STARTED at `startedAt` proves the credential it began with: the strongest
    evidence Kosmos sees, and the only way a terminal `muse login` on the Keychain is ever seen.
    Writes nothing when a refusal is as late or later (round 2). True when it wrote. Never throws. */
function markTurnSignedIn(startedAt = Date.now()) {
  try {
    const now = latest();
    if (now.note && now.note.at >= startedAt) return false;
    if (now.mark !== null && now.mark >= startedAt) return false;   // nothing to add
    record('mark', startedAt, {});
    return true;
  } catch { return false; }
}
/** Kosmos's own sign-in finished at `at`: a mark. Throws on a failed write (the sign-in must not say
    done when nothing was recorded). */
function markKosmosSignedIn(at = Date.now()) { record('mark', at, {}); }
/** Kosmos's own sign-in saw Muse fail to SAVE the credential at `at`: a note, so an older mark cannot
    answer yes beside the failure (slice 3a round 9). Never throws. */
function markSaveFailed(at = Date.now()) {
  try { fs.rmSync(signedInMarker(), { force: true }); } catch { /* none */ }
  try { const f = fileAtStart(); record('note', at, { metaDigest: f.metaDigest, fileUnread: f.fileUnread }); return true; } catch { return false; }
}
/* Muse's own file store (the file backend, and every non-Mac build): XDG_CONFIG_HOME, else ~/.config. */
function authFile() {
  const base = process.env.XDG_CONFIG_HOME || path.join(runners.homeDir(), '.config');
  return path.join(base, 'muse', 'auth.json');
}

/** { signedIn, how }: a file check, never a run, never the Keychain, never a value read out.
    Known gap (round 1 of slice 3a): nothing sees a `muse logout` or a removed Keychain item by
    itself. From slice 3c-1 the first refused turn ends the answer; a completed turn that BEGAN after
    that refusal, a Kosmos sign-in, or a different credential in Muse's own file restores it. Before
    any turn has run it can still say yes. Times are this Mac's wall clock: a clock stepped back can
    misorder records made within the step (a stated limit, review round 5). */
function signedIn() {
  const { mark, note } = latest();
  const { meta } = readMeta();
  if (meta && (!note || (!note.fileUnread && note.metaDigest !== metaDigest(meta)))) return { signedIn: true, how: 'file' };
  if (mark !== null && (!note || mark > note.at)) return { signedIn: true, how: 'kosmos' };
  return { signedIn: false, how: null };
}

let hardCapMs = VERSION_HARD_CAP_MS;
let timeoutMs = VERSION_TIMEOUT_MS;
const REAL = { runVersion };
function setRunnerForTests(fn, opts) { if (fn) runVersion = fn; if (opts && opts.hardCapMs) hardCapMs = opts.hardCapMs; if (opts && opts.timeoutMs) timeoutMs = opts.timeoutMs; }
function resetForTests() { runVersion = REAL.runVersion; hardCapMs = VERSION_HARD_CAP_MS; timeoutMs = VERSION_TIMEOUT_MS; }

module.exports = { installed, version, parseVersion, enabled, NOT_INSTALLED_BECAUSE, signedIn, signinFolder, signedInMarker, eventsFolder, latest, markSignedOut, markTurnSignedIn, markKosmosSignedIn, markSaveFailed, fileAtStart, authFile, VERSION_TIMEOUT_MS, VERSION_HARD_CAP_MS, VERSION_UNKNOWN_BECAUSE, CHECK_FAILED_BECAUSE, setRunnerForTests, resetForTests };

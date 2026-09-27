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
/* #3939 slice 3c-1: what Kosmos has SEEN about the credential, as two records in the sign-in folder.
   Each carries its own time, an integer from Date.now() written INSIDE the file. File mtimes are
   never compared: they keep fractions of a millisecond that Date.now() drops, so an mtime can read
   as later than a clock taken after it (review round 3).
   - The MARK (signed-in.json): Muse worked. `at` is when that was known to be true: a completed turn's
     START (it proves the credential it began with), or the moment Kosmos's own sign-in finished.
   - The NOTE (signed-out.json): Muse refused. `at` is the refused turn's START.
   The answer is whichever is later; a tie is signed out, the safe direction. So a slow success cannot
   hide a refusal from a turn that began after it (round 3), and a refusal cannot undo a sign-in that
   finished after the refused turn began (round 1).
   Muse's own auth.json (the file backend) counts after a refusal only when its meta entry is a
   DIFFERENT credential from the one refused: the note keeps a canonical digest of the entry the
   refused turn STARTED with, never the entry, so a rewrite for any other reason does not revive it. */
function signedOutMarker() { return path.join(signinFolder(), 'signed-out.json'); }
/* Canonical: keys sorted at every depth, so the same credential written in another key order is the
   same credential (review round 2). */
const canonical = (v) => (Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']'
  : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}'
  : JSON.stringify(v));
const metaDigest = (meta) => require('node:crypto').createHash('sha256').update(canonical(meta)).digest('hex');
/* { meta, unread }: the meta entry, or null when there is none. `unread` when the file is there but
   could not be read or parsed (permissions, or Muse part-way through rewriting it): that is not the
   same as "no entry" (review round 3). */
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
/* A record's time. A mark from before this slice holds an ISO string, or nothing: read that too, and
   fall back to the file's mtime floored to the millisecond. null when there is no record. */
function readRecord(file) {
  let st;
  try { st = fs.statSync(file); } catch (e) { return e && e.code === 'ENOENT' ? null : { at: Infinity, unreadable: true }; }
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { at: Infinity, unreadable: true }; }
  let at = j && j.at;
  if (typeof at === 'string') at = Date.parse(at);
  if (typeof at !== 'number' || !Number.isFinite(at)) at = Math.floor(st.mtimeMs);
  return { at, unreadable: false, j };
}
/* The note as the answer reads it. One that is there but cannot be read is a refusal with no digest
   and an infinite time (fail closed: "signed out" asks the person to act, never a false yes). That
   includes the note vanishing between the stat and the read: that one read answers signed out. */
function readNote() {
  const r = readRecord(signedOutMarker());
  if (!r) return null;
  if (r.unreadable) return { at: Infinity, digest: null, fileUnread: false, unreadable: true };
  return { at: r.at, digest: typeof r.j.metaDigest === 'string' ? r.j.metaDigest : null, fileUnread: r.j.fileUnread === true, unreadable: false };
}
// An unreadable mark is NO mark (never a yes), the same safe direction as an unreadable note's refusal.
function readMark() { const r = readRecord(signedInMarker()); return r && !r.unreadable ? r.at : null; }

/** Record that Muse refused the credential for a turn that STARTED at `startedAt` (ms). Writes nothing
    when the mark is LATER than that start (a sign-in finished while the refused turn ran, round 1), and
    never moves an existing note back in time. True when it wrote. Never throws. */
/* Written to a temporary file and renamed into place, so a reader in another board process (several
   boards on one Mac share this folder, review round 5) sees the old record or the new one, never half
   of one. */
function writeRecord(file, obj) {
  fs.mkdirSync(signinFolder(), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + process.pid + '.' + Math.random().toString(36).slice(2) + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* none */ } throw e; }
}
/** What Muse's own file holds, as the note records it: taken when a turn STARTS, because a refusal
    is about the credential the turn began with, not whatever the file holds when it reports
    (review round 5: a `muse login` or `logout` during the turn). */
function fileAtStart() {
  const { meta, unread } = readMeta();
  return { metaDigest: meta ? metaDigest(meta) : null, fileUnread: unread };
}

function markSignedOut(startedAt = Date.now(), atStart = null) {
  try {
    const mark = readMark();
    if (mark !== null && mark > startedAt) return false;
    // A newer refusal is already the freshest fact: a late one adds nothing, and must not replace the
    // newer note's digest with whatever Muse's file holds NOW (review round 4).
    const old = readNote();
    if (old && !old.unreadable && old.at > startedAt) return false;
    const file = atStart || fileAtStart();
    writeRecord(signedOutMarker(), { at: startedAt, metaDigest: file.metaDigest, fileUnread: file.fileUnread });
    return true;
  } catch { return false; }
}
/** A completed turn that STARTED at `startedAt` proves the credential it began with: the strongest
    evidence Kosmos sees, and the only way a terminal `muse login` on the Keychain is ever seen. Writes
    nothing when a refusal is as late or later (another agent's turn began after this one and was
    refused, round 2); never moves the mark back. An unreadable note is removed rather than left to
    block every later turn (round 3). True when it wrote. Never throws. */
function markTurnSignedIn(startedAt = Date.now()) {
  try {
    const note = readNote();
    // Records are renamed into place, so an unreadable note is real damage, not a write in progress:
    // removed rather than left to block every later turn (round 3).
    if (note && note.unreadable) fs.rmSync(signedOutMarker(), { force: true });
    else if (note && note.at >= startedAt) return false;
    const mark = readMark();
    const at = mark !== null && mark > startedAt ? mark : startedAt;
    // The note is NOT removed (review round 5): the later mark already wins, and another board process
    // may have written a newer refusal since the check above.
    writeRecord(signedInMarker(), { at });
    return true;
  } catch { return false; }
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
  const note = readNote();
  const { meta } = readMeta();
  if (meta && (!note || (!note.unreadable && !note.fileUnread && note.digest !== metaDigest(meta)))) return { signedIn: true, how: 'file' };
  const mark = readMark();
  if (mark !== null && (!note || mark > note.at)) return { signedIn: true, how: 'kosmos' };
  return { signedIn: false, how: null };
}

let hardCapMs = VERSION_HARD_CAP_MS;
let timeoutMs = VERSION_TIMEOUT_MS;
const REAL = { runVersion };
function setRunnerForTests(fn, opts) { if (fn) runVersion = fn; if (opts && opts.hardCapMs) hardCapMs = opts.hardCapMs; if (opts && opts.timeoutMs) timeoutMs = opts.timeoutMs; }
function resetForTests() { runVersion = REAL.runVersion; hardCapMs = VERSION_HARD_CAP_MS; timeoutMs = VERSION_TIMEOUT_MS; }

module.exports = { installed, version, parseVersion, enabled, NOT_INSTALLED_BECAUSE, signedIn, signinFolder, signedInMarker, signedOutMarker, markSignedOut, markTurnSignedIn, fileAtStart, authFile, VERSION_TIMEOUT_MS, VERSION_HARD_CAP_MS, VERSION_UNKNOWN_BECAUSE, CHECK_FAILED_BECAUSE, setRunnerForTests, resetForTests };

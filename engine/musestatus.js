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

/** Whether Meta Muse shows anywhere: on a Mac (the only platform the runner is built for), turned on by
    AGENT_WORKFORCE_MUSE=1 or by the preview marker file in this board's data folder. Off by default, so
    every screen is as before until someone turns it on. */
function enabled(platform = process.platform) {
  if (platform !== 'darwin') return false;
  if (process.env.AGENT_WORKFORCE_MUSE === '1') return true;
  try { return fs.existsSync(previewMarker()); } catch { return false; }
}
/* #3939: the marker that turns the preview on for one computer. The board's launchd job is rewritten on
   every install and update with a fixed list of variables, so an environment variable set there does not
   last; this file does. Read on every check: creating or deleting it needs no restart. */
const PREVIEW_MARKER = 'muse-preview-on';
function previewMarker() { return path.join(require('./store').ROOT, PREVIEW_MARKER); }

/* The mark Kosmos leaves when ITS sign-in ended "Logged in." (engine/musesignin.js writes it). On a
   Mac, Muse keeps the sign-in in the login Keychain, which Kosmos never reads: an item named "meta"
   could be anybody's. */
function signinFolder() { return path.join(require('./store').ROOT, 'muse-signin'); }   // the sign-in's folder, and its mark's
function signedInMarker() { return path.join(signinFolder(), 'signed-in.json'); }
/* #3939 slice 3c-1: what Kosmos has SEEN about the credential, as APPEND-ONLY EVENTS (review round 6).
   Several boards on one Mac share this folder, so any read-decide-write can interleave with another
   process. Nothing here reads a record and then rewrites it: every observation is its own file,
   created once by rename, and the answer is a pure read over the latest of each kind.
   Three kinds, each with an integer Date.now() time in its NAME (never a file mtime, round 3):
   - TURN (Muse worked): a completed turn, named by its START (it proves the credential it began with).
   - SIGN (Muse worked): Kosmos's own sign-in, named by the moment it FINISHED.
   - NOTE (Muse refused): a refused turn, named by its FINISH, with its START in the body, plus a
     canonical digest of Muse's auth.json meta entry as it was at that start (never the entry) and
     whether the file could be read then.
   When a turn read the credential, somewhere between its start and finish, is unknown. So an overlap
   is ambiguous, and every ambiguity settles to SIGNED OUT (review round 7):
   - a completed turn beats a refusal only when it STARTED after that refusal FINISHED;
   - Kosmos's own sign-in beats a refusal when it FINISHED after that refused turn STARTED (a sign-in
     during a failing turn is the person fixing it, round 1);
   - ties go to signed out. The slice 3a signed-in.json is read as one more SIGN. */
function eventsFolder() { return path.join(signinFolder(), 'events'); }
const EVENT_NAME = /^(\d{15})-(turn|sign|note)-[a-z0-9.]+\.json$/;
const MAX_AT = 1e15;   // fifteen digits: until the year 33658
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

/* Slice 3a's single mark file, as a SIGN time, or null. A time in the future is ignored: it would
   answer yes for ever (round 7). */
function legacySign() {
  try {
    const st = fs.statSync(signedInMarker());
    if (!st.isFile()) return null;
    let at;
    try { const j = JSON.parse(fs.readFileSync(signedInMarker(), 'utf8')); at = typeof j.at === 'string' ? Date.parse(j.at) : j.at; } catch { at = undefined; }
    if (typeof at !== 'number' || !Number.isFinite(at)) at = Math.floor(st.mtimeMs);
    return at > Date.now() ? null : at;
  } catch { return null; }
}

/* The latest event of each kind: { turn, sign, note }. `note` combines EVERY note at the latest
   finish, failing closed (round 7): its start is the latest of their starts, its digests are all of
   theirs, and it is fileUnread if any is, or if any body cannot be read. */
function readLatest() {
  let turn = null; let sign = null; let noteAt = null; let noteNames = [];
  let names = [];
  try { names = fs.readdirSync(eventsFolder()); } catch { /* no events yet */ }
  for (const n of names) {
    const m = EVENT_NAME.exec(n);
    if (!m) continue;
    const at = Number(m[1]);
    if (m[2] === 'turn') { if (turn === null || at > turn) turn = at; }
    else if (m[2] === 'sign') { if (sign === null || at > sign) sign = at; }
    else if (noteAt === null || at > noteAt) { noteAt = at; noteNames = [n]; }
    else if (at === noteAt) noteNames.push(n);
  }
  const old = legacySign();
  if (old !== null && (sign === null || old > sign)) sign = old;
  let note = null;
  if (noteAt !== null) {
    note = { finish: noteAt, start: null, digests: [], fileUnread: false, vanished: false };
    for (const n of noteNames) {
      let j;
      try { j = JSON.parse(fs.readFileSync(path.join(eventsFolder(), n), 'utf8')); }
      catch (e) { if (e && e.code === 'ENOENT') note.vanished = true; note.fileUnread = true; continue; }
      const s = Number.isSafeInteger(j && j.start) ? Math.min(j.start, noteAt) : noteAt;
      if (note.start === null || s > note.start) note.start = s;
      if (typeof j.metaDigest === 'string') note.digests.push(j.metaDigest);
      if (j.fileUnread === true) note.fileUnread = true;
    }
    if (note.start === null) note.start = noteAt;   // no readable body: the latest a refused turn could have started
  }
  return { turn, sign, note };
}
/* A note pruned between the listing and the read (another board wrote a newer one) is read again
   once, so that one read does not answer from a half-seen folder (round 7). */
function latest() {
  const r = readLatest();
  return r.note && r.note.vanished ? readLatest() : r;
}

/* One new event file, created by rename so no reader ever sees half of one. Then, best effort,
   events older than the newest of their OWN kind are removed: a remover only removes a file when it
   sees a strictly newer one of that kind, so the newest of each kind always survives. Leftover
   temporary files (a process killed between the write and the rename) older than a minute go too. */
function record(kind, at, body) {
  if (!Number.isSafeInteger(at) || at < 0 || at >= MAX_AT) throw new Error('an event time must be a whole number of milliseconds');
  const dir = eventsFolder();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const name = String(at).padStart(15, '0') + '-' + kind + '-' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.json';
  const tmp = path.join(dir, '.' + name + '.tmp');
  try {
    fs.writeFileSync(tmp, JSON.stringify(body) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, path.join(dir, name));
  } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* none */ } throw e; }
  try {
    const all = fs.readdirSync(dir);
    const mine = all.map((n) => EVENT_NAME.exec(n)).filter((m) => m && m[2] === kind);
    const newest = Math.max(...mine.map((m) => Number(m[1])));
    for (const m of mine) if (Number(m[1]) < newest) fs.rmSync(path.join(dir, m[0]), { force: true });
    for (const n of all) {
      if (!n.startsWith('.') || !n.endsWith('.tmp')) continue;
      try { if (Date.now() - fs.statSync(path.join(dir, n)).mtimeMs > 60000) fs.rmSync(path.join(dir, n), { force: true }); } catch { /* gone */ }
    }
  } catch { /* pruning is housekeeping; the answer never depends on it */ }
}

/** Record that Muse refused the credential for a turn that STARTED at `startedAt` and FINISHED at
    `finishedAt` (ms), with Muse's file as it was at the start (`atStart`, from fileAtStart). Writes
    nothing when a note that finished later is already there (a late refusal adds nothing and must
    not stand beside it, round 4). True when it wrote. Never throws. */
function markSignedOut(startedAt = Date.now(), atStart = null, finishedAt = startedAt) {
  try {
    const finish = Math.max(startedAt, finishedAt);
    const now = latest();
    if (now.note && now.note.finish > finish) return false;
    const file = atStart || fileAtStart();
    record('note', finish, { start: startedAt, metaDigest: file.metaDigest, fileUnread: file.fileUnread });
    return true;
  } catch { return false; }
}
/** A completed turn that STARTED at `startedAt` proves the credential it began with, and is the only
    way a terminal `muse login` on the Keychain is ever seen. True when it wrote. Never throws. */
function markTurnSignedIn(startedAt = Date.now()) {
  try {
    const now = latest();
    if (now.turn !== null && now.turn >= startedAt) return false;   // nothing to add
    record('turn', startedAt, {});
    return true;
  } catch { return false; }
}
/** Kosmos's own sign-in finished at `at`. Throws on a failed write (the sign-in must not say done
    when nothing was recorded). Slice 3a's single mark file goes: nothing writes it any more. */
function markKosmosSignedIn(at = Date.now()) {
  record('sign', at, {});
  try { fs.rmSync(signedInMarker(), { force: true }); } catch { /* none */ }
}
/** Kosmos's own sign-in saw Muse fail to SAVE the credential at `at`: a note, so an older sign-in
    cannot answer yes beside the failure (slice 3a round 9). It names no credential in Muse's file:
    nothing refused that one (round 7). Never throws. */
function markSaveFailed(at = Date.now()) {
  try { fs.rmSync(signedInMarker(), { force: true }); } catch { /* none */ }
  try { record('note', at, { start: at, metaDigest: null, fileUnread: false }); return true; } catch { return false; }
}
/* Muse's own file store (the file backend, and every non-Mac build): XDG_CONFIG_HOME, else ~/.config. */
function authFile() {
  const base = process.env.XDG_CONFIG_HOME || path.join(runners.homeDir(), '.config');
  return path.join(base, 'muse', 'auth.json');
}

/** { signedIn, how }: a file check, never a run, never the Keychain, never a value read out.
    Known gap (round 1 of slice 3a): nothing sees a `muse logout` or a removed Keychain item by
    itself. From slice 3c-1 the first refused turn ends the answer; a completed turn that began after
    that refusal finished, a Kosmos sign-in, or a different credential in Muse's own file restores it.
    Before any turn has run it can still say yes. Times are this Mac's wall clock: a clock stepped
    back can misorder events made within the step (a stated limit, review round 5). */
function signedIn() {
  const { turn, sign, note } = latest();
  const { meta } = readMeta();
  if (meta && (!note || (!note.fileUnread && !note.digests.includes(metaDigest(meta))))) return { signedIn: true, how: 'file' };
  if (turn !== null && (!note || turn > note.finish)) return { signedIn: true, how: 'kosmos' };
  if (sign !== null && (!note || sign > note.start)) return { signedIn: true, how: 'kosmos' };
  return { signedIn: false, how: null };
}

let hardCapMs = VERSION_HARD_CAP_MS;
let timeoutMs = VERSION_TIMEOUT_MS;
const REAL = { runVersion };
function setRunnerForTests(fn, opts) { if (fn) runVersion = fn; if (opts && opts.hardCapMs) hardCapMs = opts.hardCapMs; if (opts && opts.timeoutMs) timeoutMs = opts.timeoutMs; }
function resetForTests() { runVersion = REAL.runVersion; hardCapMs = VERSION_HARD_CAP_MS; timeoutMs = VERSION_TIMEOUT_MS; }

module.exports = { installed, version, parseVersion, enabled, previewMarker, PREVIEW_MARKER, NOT_INSTALLED_BECAUSE, signedIn, signinFolder, signedInMarker, eventsFolder, latest, markSignedOut, markTurnSignedIn, markKosmosSignedIn, markSaveFailed, fileAtStart, authFile, VERSION_TIMEOUT_MS, VERSION_HARD_CAP_MS, VERSION_UNKNOWN_BECAUSE, CHECK_FAILED_BECAUSE, setRunnerForTests, resetForTests };

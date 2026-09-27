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
function signedInMarker() { return path.join(require('./store').ROOT, 'muse-signin', 'signed-in.json'); }
/* Muse's own file store (the file backend, and every non-Mac build): XDG_CONFIG_HOME, else ~/.config. */
function authFile() {
  const base = process.env.XDG_CONFIG_HOME || path.join(runners.homeDir(), '.config');
  return path.join(base, 'muse', 'auth.json');
}

/** { signedIn, how }: a file check, never a run, never the Keychain, never a value read out. */
function signedIn() {
  try {
    const j = JSON.parse(fs.readFileSync(authFile(), 'utf8'));
    const meta = j && j.providers && j.providers.meta;
    // Present and not empty: `muse logout` leaves {"providers":{}}.
    if (meta && typeof meta === 'object' && Object.keys(meta).length) return { signedIn: true, how: 'file' };
  } catch { /* no file, or not Muse's */ }
  try { if (fs.statSync(signedInMarker()).isFile()) return { signedIn: true, how: 'kosmos' }; } catch { /* never signed in here */ }
  return { signedIn: false, how: null };
}

let hardCapMs = VERSION_HARD_CAP_MS;
let timeoutMs = VERSION_TIMEOUT_MS;
const REAL = { runVersion };
function setRunnerForTests(fn, opts) { if (fn) runVersion = fn; if (opts && opts.hardCapMs) hardCapMs = opts.hardCapMs; if (opts && opts.timeoutMs) timeoutMs = opts.timeoutMs; }
function resetForTests() { runVersion = REAL.runVersion; hardCapMs = VERSION_HARD_CAP_MS; timeoutMs = VERSION_TIMEOUT_MS; }

module.exports = { installed, version, parseVersion, enabled, signedIn, signedInMarker, authFile, VERSION_TIMEOUT_MS, VERSION_HARD_CAP_MS, VERSION_UNKNOWN_BECAUSE, CHECK_FAILED_BECAUSE, setRunnerForTests, resetForTests };

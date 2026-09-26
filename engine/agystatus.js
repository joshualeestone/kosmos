'use strict';
/**
 * #3568: is Gemini on a Google subscription ready on this computer? Two facts about Google's
 * Antigravity CLI (agy), the program an Antigravity agent runs on:
 *
 *  - INSTALLED: runners.resolveBin('antigravity') finds a runnable agy (its own installer puts it
 *    in ~/.local/bin/agy; Kosmos runs that installer on a press, see install()). Cheap.
 *  - SIGNED IN: agy keeps its Google sign-in to itself (no file Kosmos can read) and has no status
 *    command, so the only test is to ask it something. A one-line prompt in print mode, run in a
 *    throwaway folder: measured 2026-09-25 on Agent1s, signed in it answered "ok" in 2 to 5 s, from a
 *    folder agy had never seen and without adding it to agy's trusted folders; signed out the same
 *    command waited about 60 s and failed. So: "ok" within the cap is signed in; anything else is
 *    NOT a confident signed-out, it is "could not confirm" (it may be the network, or a slow Mac).
 *
 * The check costs one tiny prompt on the person's subscription, so it runs only when a screen asks
 * (a button press), never on a poll, and concurrent asks share one run (engine/inflight.js).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const runners = require('./runners');
const inflight = require('./inflight');

const PROMPT = 'Reply with the single word ok';
const CAP_SECONDS = 30;   // agy's own --print-timeout
const KILL_MS = 40000;    // our backstop if agy ignores its own timeout

/** { installed, bin }: cheap, safe to call on every render. */
function installed() {
  const r = runners.resolveBin('antigravity');
  return { installed: !!(r && r.present), bin: r ? r.bin : null, because: r && r.because ? r.because : null };
}
/* Offered at all? Only where agy can run (a Mac: the supervisor refuses agy on Windows) and while
   the runner is switched on (AGENT_WORKFORCE_ANTIGRAVITY=0 turns it off; review round 3: with it off
   the screen must not offer a path create would refuse). */
function supported() { return process.platform === 'darwin'; }
function enabled() { return require('./create').antigravityEnabled(); }
function offered() { return supported() && enabled(); }
/* What a screen is told: whether it is offered and installed, never the path (review round 1). */
function installedForScreen() {
  return { installed: offered() && installed().installed, enabled: enabled(), supported: supported() };
}
/* Kosmos installs into this computer's own home only: a sandboxed board (AGENT_WORKFORCE_HOME) or an
   agy named elsewhere (AGENT_WORKFORCE_ANTIGRAVITY_BIN) would install where it then does not look
   (review round 3). */
let sandboxInstallAllowedForTests = false;
function sandboxed() { return !sandboxInstallAllowedForTests && !!(process.env.AGENT_WORKFORCE_HOME || process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN); }
function allowSandboxInstallForTests(v) { sandboxInstallAllowedForTests = !!v; }

/* The seam a test replaces: run agy once and hand back (err, stdout). */
let runAgy = (bin, done) => {
  let dir = null;
  try { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-agy-check-')); } catch { dir = os.tmpdir(); }
  execFile(bin, ['-p', PROMPT, '--print-timeout', CAP_SECONDS + 's'], { cwd: dir, timeout: KILL_MS, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 },
    (err, stdout) => {
      if (dir && dir !== os.tmpdir()) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
      done(err, String(stdout || ''));
    });
};

function checkOnce() {
  return new Promise((resolve) => {
    const inst = installed();
    if (!offered()) { resolve({ installed: false, signedIn: false, offered: false, because: 'Gemini on a Google subscription is not offered on this computer' }); return; }
    if (!inst.installed) {
      resolve({ installed: false, signedIn: false, because: inst.because || 'Antigravity is not installed on this computer' });
      return;
    }
    /* A hard cap of our own (review round 1): execFile's timeout signals agy but its callback waits
       for stdout to close, which a child agy started can hold open; and a check that never settles
       would hold every later one (inflight shares the unsettled run). */
    let done = false;
    const unknown = { installed: true, signedIn: null,
      because: 'Antigravity did not answer, so it may need signing in (or this computer is offline)' };
    const cap = setTimeout(() => { if (!done) { done = true; resolve(unknown); } }, KILL_MS + 5000);
    runAgy(inst.bin, (err, out) => {
      if (done) return;
      done = true; clearTimeout(cap);
      // The whole answer must be "ok" (review round 7): "Not ok" or a banner with OK in it is not signed in.
      resolve(!err && /^\s*ok[.!]?\s*$/i.test(out) ? { installed: true, signedIn: true } : unknown);
    });
  });
}
const shared = inflight.collapse(checkOnce);

/** { installed, signedIn, because? }: signedIn is true; false only when agy is not installed; null when
    it could not be confirmed, never a guessed "signed out". */
function check() { return shared().then((r) => { remember(r); return r; }); }

/* #3998: the LAST answer, so Settings can show the subscription as an account row without spending
   a prompt on every repaint. Saved beside the sign-in folder, so a board restart keeps it. Only a
   confident answer is kept: signedIn true, or false because agy is not installed; "could not
   confirm" (null) leaves the last one standing. */
let lastFile = () => path.join(require('./store').ROOT, 'agy-signin', 'last.json');
function remember(r) {
  if (!r || (r.signedIn !== true && !(r.signedIn === false && r.installed === false))) return;
  const rec = { signedIn: r.signedIn === true, at: new Date().toISOString() };
  try { fs.mkdirSync(path.dirname(lastFile()), { recursive: true, mode: 0o700 }); fs.writeFileSync(lastFile(), JSON.stringify(rec), { mode: 0o600 }); } catch { /* best effort */ }
}
/** { signedIn, at } from the last confident answer, or null if there has been none. */
function lastKnown() {
  try { const r = JSON.parse(fs.readFileSync(lastFile(), 'utf8')); return r && typeof r.signedIn === 'boolean' ? r : null; } catch { return null; }
}
/** Forget it (Remove on the account row): Kosmos stops listing it; agy's own sign-in is untouched. */
function forget() { try { fs.rmSync(lastFile(), { force: true }); } catch { /* none */ } }
/* The Google account agy is signed in as, if its account file names one (~/.gemini/google_accounts.json,
   "active"). Read-only; null when absent or unreadable. */
let accountsFile = () => path.join(os.homedir(), '.gemini', 'google_accounts.json');
function activeEmail() {
  try {
    const j = JSON.parse(fs.readFileSync(accountsFile(), 'utf8'));
    return j && typeof j.active === 'string' && /^[^\s@]+@[^\s@]+$/.test(j.active) ? j.active : null;
  } catch { return null; }
}
function setLastFileForTests(fn) { lastFile = fn; }
function setAccountsFileForTests(fn) { accountsFile = fn; }

/* #3998: signing in is engine/agysignin.js (agy's interactive sign-in run out of sight); the old
   open-it-in-Terminal path is gone. */
/* Install agy the way Google documents it (antigravity.google/docs/cli/install): its installer
   script, fetched over https from antigravity.google, puts agy in ~/.local/bin/agy. Kosmos installs
   every provider's terminal agent itself behind a Confirm press, and a person is never told to open
   a Terminal (#996), so this runs only on that press. Nothing from the page reaches the command: the
   URL is fixed and the script is saved to a private temp file and run by bash, not piped, so a failed
   download fails the install instead of running half a script. */
const INSTALL_URL = 'https://antigravity.google/cli/install.sh';
const INSTALL_MS = 300000;
let runInstall = (done) => {
  let dir;
  try { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-agy-install-')); } catch (e) { done(e); return; }
  const script = path.join(dir, 'install.sh');
  const clean = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } };
  execFile('/usr/bin/curl', ['-fsSL', '--proto', '=https', '-o', script, INSTALL_URL], { timeout: 60000, killSignal: 'SIGKILL' }, (err) => {
    if (err) { clean(); done(err); return; }
    /* Only what an installer needs, never the board's own environment (review round 9: its keys and
       settings are not Google's script's business). */
    const env = {};
    for (const k of ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG']) if (process.env[k]) env[k] = process.env[k];
    const child = execFile('/bin/bash', [script], { cwd: dir, timeout: INSTALL_MS, killSignal: 'SIGKILL', env }, (err2) => { clean(); done(err2); });
    // Nothing is typed into it (review round 3): a step that prompts reads end-of-input and moves on.
    if (child && child.stdin) child.stdin.end();
  });
};
function installOnce() {
  return new Promise((resolve) => {
    if (!supported()) { resolve({ ok: false, because: 'Gemini on a Google subscription is not available on this computer yet' }); return; }
    if (!enabled()) { resolve({ ok: false, because: 'Gemini on a Google subscription is switched off on this computer' }); return; }
    if (installed().installed) { resolve({ ok: true, installed: true }); return; }
    if (sandboxed()) { resolve({ ok: false, installed: false, because: 'this board is set to a different home, so Kosmos will not install Antigravity into this computer\'s own' }); return; }
    /* A hard cap of our own, as check() has (review round 2): an installer child that holds stdout
       would keep execFile's callback from firing, and an unsettled install would hold every later one. */
    let done = false;
    const cap = setTimeout(() => {
      if (done) return;
      done = true;
      const now = installed();
      resolve(now.installed ? { ok: true, installed: true }
        : { ok: false, installed: false, because: 'Google\'s Antigravity installer took too long, so we stopped waiting' });
    }, 60000 + INSTALL_MS + 10000);
    runInstall((err) => {
      if (done) return;
      done = true; clearTimeout(cap);
      const now = installed();
      resolve(now.installed ? { ok: true, installed: true }
        : { ok: false, installed: false, because: err ? 'Google\'s Antigravity installer did not finish' : 'the installer finished but Antigravity was not found where it installs' });
    });
  });
}
const sharedInstall = inflight.collapse(installOnce);
function install() { return sharedInstall(); }
function setInstallerForTests(fn) { runInstall = fn; }
/* The real runner, opener and installer, kept so a test file can put them back when it is done. */
const REAL = {};
function resetForTests() { runAgy = REAL.runAgy; runInstall = REAL.runInstall; sandboxInstallAllowedForTests = false; }
function setRunnerForTests(fn) { runAgy = fn; }

REAL.runAgy = runAgy; REAL.runInstall = runInstall;
module.exports = { resetForTests, allowSandboxInstallForTests, installed, installedForScreen, offered, check, install, setRunnerForTests, setInstallerForTests, PROMPT, INSTALL_URL,
  remember, lastKnown, forget, activeEmail, setLastFileForTests, setAccountsFileForTests };

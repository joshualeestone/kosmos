'use strict';
/**
 * #3568: is Gemini on a Google subscription ready on this Mac? Two facts about Google's
 * Antigravity CLI (agy), the program an Antigravity agent runs on:
 *
 *  - INSTALLED: runners.resolveBin('antigravity') finds a runnable agy (its own installer puts it
 *    in ~/.local/bin/agy; Kosmos does not install it). Cheap, read on every call.
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
/* What a screen is told: whether it is installed, never the path (review round 1). */
function installedForScreen() { const i = installed(); return { installed: i.installed }; }

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
      resolve(!err && /\bok\b/i.test(out) ? { installed: true, signedIn: true } : unknown);
    });
  });
}
const shared = inflight.collapse(checkOnce);

/** { installed, signedIn: true | null, because? }: null means "could not confirm", never "signed out". */
function check() { return shared(); }

/* Open agy once, in Terminal, so it can sign in. Google's docs (antigravity.google/docs/cli/install):
   started locally without a saved session, "The CLI automatically launches your local default web
   browser. Sign in using your approved account credentials." So Kosmos types nothing into it; the
   person signs in in the browser and presses Check again. macOS only (agy is refused on Windows). */
let openTerminal = (bin, done) => execFile('/usr/bin/open', ['-a', 'Terminal', bin], { timeout: 15000 }, (err) => done(err));
function openForSignIn() {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') { resolve({ ok: false, because: 'Kosmos can open Antigravity for you on a Mac only' }); return; }
    const inst = installed();
    if (!inst.installed) { resolve({ ok: false, because: 'Antigravity is not installed on this computer' }); return; }
    openTerminal(inst.bin, (err) => resolve(err
      ? { ok: false, because: 'we could not open Antigravity\'s sign-in just now' }
      : { ok: true }));
  });
}
/* Install agy the way Google documents it (antigravity.google/docs/cli/install): its installer
   script, fetched over https from antigravity.google, puts agy in ~/.local/bin/agy. Kosmos installs
   every provider's terminal agent itself behind a Confirm press, and a person is never told to open
   a Terminal (#996), so this runs only on that press. Nothing from the page reaches the command: the
   URL is fixed and the script is saved to a private temp file and run by bash, not piped, so a failed
   download fails the install instead of running half a script. */
const INSTALL_URL = 'https://antigravity.google/cli/install.sh';
let runInstall = (done) => {
  let dir;
  try { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-agy-install-')); } catch (e) { done(e); return; }
  const script = path.join(dir, 'install.sh');
  const clean = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } };
  execFile('/usr/bin/curl', ['-fsSL', '--proto', '=https', '-o', script, INSTALL_URL], { timeout: 60000 }, (err) => {
    if (err) { clean(); done(err); return; }
    execFile('/bin/bash', [script], { cwd: dir, timeout: 300000, env: { ...process.env, HOME: os.homedir() } }, (err2) => { clean(); done(err2); });
  });
};
function installOnce() {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') { resolve({ ok: false, because: 'Kosmos can install Antigravity on a Mac only' }); return; }
    if (installed().installed) { resolve({ ok: true, installed: true }); return; }
    runInstall((err) => {
      const now = installed();
      resolve(now.installed ? { ok: true, installed: true }
        : { ok: false, installed: false, because: err ? 'Google\'s Antigravity installer did not finish, so nothing changed' : 'the installer finished but Antigravity was not found where it installs' });
    });
  });
}
const sharedInstall = inflight.collapse(installOnce);
function install() { return sharedInstall(); }
function setInstallerForTests(fn) { runInstall = fn; }
/* The real runner, opener and installer, kept so a test file can put them back when it is done. */
const REAL = {};
function resetForTests() { runAgy = REAL.runAgy; openTerminal = REAL.openTerminal; runInstall = REAL.runInstall; }
function setOpenerForTests(fn) { openTerminal = fn; }
function setRunnerForTests(fn) { runAgy = fn; }

REAL.runAgy = runAgy; REAL.openTerminal = openTerminal; REAL.runInstall = runInstall;
module.exports = { resetForTests, installed, installedForScreen, check, openForSignIn, install, setRunnerForTests, setOpenerForTests, setInstallerForTests, PROMPT, INSTALL_URL };

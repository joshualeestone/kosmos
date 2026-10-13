'use strict';
/**
 * #6004: install Meta's Muse Code the way Kosmos installs every provider's terminal agent: on a Confirm press,
 * never on a poll, and a person is never told to open a Terminal (#996). Mac only, as the Muse runner is.
 *
 * Meta documents one install route: its installer script, fetched over https from dev.meta.ai (measured on the
 * Mortals Mac 2026-09-26 and 2026-10-12, sha256 5196d820...0a0ca both times, no sudo). It fetches a launcher from
 * api.meta.ai and puts it at ~/.local/bin/muse, where engine/runners.js resolveBin('muse') looks. Run as the
 * Antigravity install is (engine/agystatus.js): the URL is fixed, nothing from the page reaches the command, the
 * script is saved to a private temp file and run by bash (never piped, so a failed download fails the install
 * instead of running half a script), with only the environment an installer needs. MUSE_NO_MODIFY_PATH=1 keeps it
 * out of the person's shell profiles: Kosmos finds Muse Code at its fixed path, so a PATH line in ~/.zshrc would
 * be an edit nobody asked for.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const musestatus = require('./musestatus');
const inflight = require('./inflight');

const INSTALL_URL = 'https://dev.meta.ai/install.sh';
const INSTALL_MS = 300000;
const DOWNLOAD_MS = 60000;

let platformForTests = null;
let sandboxAllowedForTests = false;
function platform() { return platformForTests || process.platform; }

/* A board run with a different home (a sandbox, a test harness) or a pinned Muse Code path must not install into
   this computer's own home: the installer writes to the real ~/.local/bin. */
function sandboxed() {
  if (sandboxAllowedForTests) return false;
  return !!(process.env.AGENT_WORKFORCE_HOME || process.env.AGENT_WORKFORCE_MUSE_BIN);
}

/** The installer's whole environment: only what an installer needs (never the board's own keys and settings), kept
    out of the person's shell profiles, and told the folder Kosmos looks in. */
function installerEnv(from = process.env) {
  const env = {};
  for (const k of ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG']) if (from[k]) env[k] = from[k];
  env.MUSE_NO_MODIFY_PATH = '1';
  env.MUSE_INSTALL_DIR = path.join(os.homedir(), '.local', 'bin');   // where resolveBin('muse') looks
  return env;
}

/* The two processes the install runs; a test replaces this to see exactly what Meta's installer would be given. */
let execSeam = (cmd, args, opts, cb) => execFile(cmd, args, opts, cb);
const REAL = {};
let runInstall = (done) => {
  let dir;
  try { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-muse-install-')); } catch (e) { done(e); return; }
  const script = path.join(dir, 'install.sh');
  const clean = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } };
  // --proto-redir as well: a redirect to plain http is refused, not followed into a script bash then runs.
  execSeam('/usr/bin/curl', ['-fsSL', '--proto', '=https', '--proto-redir', '=https', '-o', script, INSTALL_URL], { timeout: DOWNLOAD_MS, killSignal: 'SIGKILL' }, (err) => {
    if (err) { clean(); done(err); return; }
    const child = execSeam('/bin/bash', [script], { cwd: dir, timeout: INSTALL_MS, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024, env: installerEnv() }, (err2) => { clean(); done(err2); });
    // Nothing is typed into it: a step that prompts reads end-of-input and moves on.
    if (child && child.stdin) child.stdin.end();
  });
};

function installOnce() {
  return new Promise((resolve) => {
    if (platform() !== 'darwin') { resolve({ ok: false, installed: false, because: 'Meta Muse is not available on this computer yet' }); return; }
    if (!musestatus.enabled(platform())) { resolve({ ok: false, installed: false, because: 'Meta Muse is switched off on this computer' }); return; }
    if (musestatus.installed().installed) { resolve({ ok: true, installed: true }); return; }
    if (sandboxed()) { resolve({ ok: false, installed: false, because: 'this board is set to a different home, so Kosmos will not install Muse Code into this computer\'s own' }); return; }
    /* Convention 3 (engine/live-execution.js): only a board started for real fetches and runs Meta's real installer.
       inTestProcess alone misses a test file run with plain `node` (no --test flags), so the real-start gate is
       checked too: server.js opens it on its real-start path only. */
    if (runInstall === REAL.runInstall && execSeam === REAL.execSeam) {
      const live = require('./live-execution');
      if (live.inTestProcess()) { resolve({ ok: false, installed: false, because: 'Kosmos will not run Meta\'s installer from a test' }); return; }
      if (!live.liveExecutionAllowed()) { resolve({ ok: false, installed: false, because: 'Kosmos runs Meta\'s installer only from a running board' }); return; }
    }
    /* A hard cap of our own: an installer child that holds stdout would keep execFile's callback from firing, and an
       unsettled install would hold every later one (the shared run below). */
    let done = false;
    const cap = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(musestatus.installed().installed ? { ok: true, installed: true }
        : { ok: false, installed: false, because: 'Meta\'s Muse Code installer took too long, so we stopped waiting' });
    }, DOWNLOAD_MS + INSTALL_MS + 10000);
    const onDone = (err) => {
      if (done) return;
      done = true; clearTimeout(cap);
      resolve(musestatus.installed().installed ? { ok: true, installed: true }
        : { ok: false, installed: false, because: err ? 'Meta\'s Muse Code installer did not finish' : 'the installer finished but Muse Code was not found where it installs' });
    };
    // A throw from the run itself is a failed install, never a rejected promise ("never rejects" below).
    try { runInstall(onDone); } catch (e) { onDone(e); }
  });
}
const sharedInstall = inflight.collapse(installOnce);
/** Install Muse Code once; concurrent presses share one run. Promise of { ok, installed, because? }; never rejects. */
function install() { return sharedInstall(); }


REAL.runInstall = runInstall; REAL.execSeam = execSeam;
function setExecForTests(fn) { execSeam = fn || REAL.execSeam; }
function setInstallerForTests(fn) { runInstall = fn; }
function setPlatformForTests(p) { platformForTests = p || null; }
function allowSandboxInstallForTests(v) { sandboxAllowedForTests = !!v; }
function resetForTests() { runInstall = REAL.runInstall; execSeam = REAL.execSeam; platformForTests = null; sandboxAllowedForTests = false; }

module.exports = { install, installerEnv, INSTALL_URL, setInstallerForTests, setExecForTests, setPlatformForTests, allowSandboxInstallForTests, resetForTests };

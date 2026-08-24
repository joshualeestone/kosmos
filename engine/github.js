'use strict';
/**
 * GitHub, connected (#529). The first Connections door with a real flow.
 *
 * Nothing here is invented: the state is what `gh auth status` says, and
 * connecting is `gh auth login --web`, GitHub's own device flow. gh prints a
 * one-time code and https://github.com/login/device, the person finishes on
 * GitHub's own page, and the token lands in gh's keyring on this Mac. Kosmos
 * never sees a password and holds no key: the tab's promise, kept by the
 * instrument itself. Agents run as the person, so the connection is theirs
 * the moment it exists.
 *
 * Read, never asserted: `state()` asks gh every time. A connection made or
 * removed outside Kosmos (a terminal, another app) shows here as it is.
 *
 * ⚠️ NOT A CARRY. When gh is absent the door says so in one plain sentence
 * and offers nothing to press; the card asked for instructions, not an
 * installer, and an install nobody asked for is the thing #548 was about.
 */
const fs = require('node:fs');
const { spawn, execFile } = require('node:child_process');

const PHASE = Object.freeze({
  IDLE: 'idle',            // nothing in flight; `connected` says the rest
  STARTING: 'starting',    // gh launched, no code yet
  AWAITING: 'awaiting',    // code and url known; the person is on GitHub's page
  COMPLETING: 'completing',// gh exited 0; confirming with gh auth status
  FAILED: 'failed',        // gh exited non-zero, or was never runnable
});

const GH_CANDIDATES = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh'];

const runnable = (p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } };
function ghBin() {
  // An override that points at nothing is "missing", the same answer a
  // clean Mac gives; a sandbox must be able to stand on that branch.
  if (process.env.AGENT_WORKFORCE_GH_BIN) return runnable(process.env.AGENT_WORKFORCE_GH_BIN) ? process.env.AGENT_WORKFORCE_GH_BIN : null;
  return GH_CANDIDATES.find(runnable) || null;
}

/* Test seams, the way connect.js and chat.js have them: `runner` answers
   `gh auth status`-shaped questions, `spawner` stands in for the login child.
   Null means the real thing. */
let runner = null;
let spawner = null;
function setRunner(fn) { runner = typeof fn === 'function' ? fn : null; }
function setSpawner(fn) { spawner = typeof fn === 'function' ? fn : null; }

function childEnv() {
  // A sandbox can point gh at its own config so a probe never touches the
  // operator's real keyring entry; the product leaves it unset.
  const env = { ...process.env };
  if (process.env.AGENT_WORKFORCE_GH_CONFIG_DIR) env.GH_CONFIG_DIR = process.env.AGENT_WORKFORCE_GH_CONFIG_DIR;
  return env;
}

/** `gh auth status` in JSON-ish terms: { connected, login } or a reason. */
function status(cb) {
  const bin = ghBin();
  if (!bin) { cb({ gh: 'missing', connected: false, login: null }); return; }
  const ask = runner || ((args, done) => execFile(bin, args, { env: childEnv(), encoding: 'utf8', timeout: 8000 },
    (err, out, errOut) => done(err ? (err.code == null ? -1 : err.code) : 0, String(out || '') + String(errOut || ''))));
  ask(['auth', 'status', '--hostname', 'github.com'], (code, text) => {
    if (code !== 0) { cb({ gh: 'present', connected: false, login: null }); return; }
    const m = String(text).match(/Logged in to github\.com account (\S+)/);
    cb({ gh: 'present', connected: true, login: m ? m[1] : null });
  });
}

let mem = { phase: PHASE.IDLE, code: null, url: null, because: null, startedAt: null };
let child = null;

function readState(cb) {
  status((s) => {
    cb({
      ...s,
      phase: mem.phase,
      code: mem.phase === PHASE.AWAITING ? mem.code : null,
      url: mem.phase === PHASE.AWAITING ? mem.url : null,
      because: mem.because,
    });
  });
}

/** Promise form for the routes. Never rejects. */
function state() {
  return new Promise((resolve) => readState(resolve));
}

const CODE_RE = /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i;
const URL_RE = /(https:\/\/github\.com\/login\/device\S*)/;

/**
 * Start GitHub's device flow. Answers the state after launch; the code
 * arrives a moment later and the page polls for it. A second start while one
 * is in flight is refused rather than spawning a second gh that would fight
 * the first for the same keyring.
 */
function start() {
  return new Promise((resolve) => {
    if (mem.phase === PHASE.STARTING || mem.phase === PHASE.AWAITING || mem.phase === PHASE.COMPLETING) {
      readState((s) => resolve({ ...s, refused: 'a GitHub sign-in is already in progress' }));
      return;
    }
    const bin = ghBin();
    if (!bin) { readState((s) => resolve({ ...s, refused: 'the GitHub tool (gh) is not on this Mac' })); return; }
    mem = { phase: PHASE.STARTING, code: null, url: null, because: null, startedAt: new Date().toISOString() };
    const make = spawner || (() => spawn(bin, ['auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https', '--skip-ssh-key'],
      { env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] }));
    let buf = '';
    const onText = (chunk) => {
      buf += String(chunk);
      if (mem.phase === PHASE.STARTING) {
        const c = buf.match(CODE_RE); const u = buf.match(URL_RE);
        if (c) { mem.code = c[1]; mem.url = u ? u[1] : 'https://github.com/login/device'; mem.phase = PHASE.AWAITING; }
      }
    };
    try {
      child = make();
    } catch (err) {
      mem = { ...mem, phase: PHASE.FAILED, because: 'we could not start the GitHub tool: ' + String((err && err.message) || err) };
      child = null;
      readState(resolve);
      return;
    }
    if (child.stdout) child.stdout.on('data', onText);
    if (child.stderr) child.stderr.on('data', onText);
    child.on('error', (err) => {
      mem = { ...mem, phase: PHASE.FAILED, because: 'the GitHub tool could not run: ' + String((err && err.message) || err) };
      child = null;
    });
    child.on('exit', (code) => {
      child = null;
      if (mem.phase === PHASE.IDLE) return; // cancelled: idle already, nothing to say
      if (code === 0) {
        mem = { ...mem, phase: PHASE.COMPLETING };
        status((s) => { mem = { phase: PHASE.IDLE, code: null, url: null, because: s.connected ? null : 'GitHub said the sign-in finished, but gh does not show an account', startedAt: null }; });
      } else {
        mem = { ...mem, phase: PHASE.FAILED, because: 'the GitHub sign-in did not finish' + (buf.trim() ? ': ' + buf.trim().split('\n').pop().slice(0, 160) : '') };
      }
    });
    readState(resolve);
  });
}

function cancel() {
  return new Promise((resolve) => {
    if (child) { try { child.kill('SIGTERM'); } catch { /* already gone */ } child = null; }
    mem = { phase: PHASE.IDLE, code: null, url: null, because: null, startedAt: null };
    readState(resolve);
  });
}

function resetForTests() { child = null; mem = { phase: PHASE.IDLE, code: null, url: null, because: null, startedAt: null }; runner = null; spawner = null; }

module.exports = { PHASE, state, start, cancel, status, ghBin, setRunner, setSpawner, resetForTests };

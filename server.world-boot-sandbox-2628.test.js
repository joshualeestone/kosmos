'use strict';
/**
 * #2628 / #2528: a board must be able to BOOT INTO a named world.
 *
 * 🛑 THE DEFECT. server.js bootstraps the active world's roots into process.env
 * (AGENT_WORKFORCE_DATA / _PROJECTS / _WORKERS under the world) and THEN ran the
 * #634 half-sandbox guard on process.env. Three roots "pointed at a sandbox" with
 * the launch dir and tmux live is exactly what that guard refuses, so every named
 * world exited 2 ("Kosmos will not start half-sandboxed"), worldbootguard
 * abandoned it on its first failed boot, and the person landed back on Kosmos 1
 * -- on every platform. The guard now audits the LAUNCH environment.
 *
 * Run for real: a board is started in a child process, in a home of its own so it
 * can reach nothing real, with tmux stubbed and its Claude config sandboxed, and a
 * named world active in its registry. It must reach `listening` and serve THAT
 * world. The control proves the old audit, on the post-world environment, refuses
 * this very setup.
 *
 *   node --test server.world-boot-sandbox-2628.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const worlds = require('./engine/worlds');
const sandbox = require('./engine/sandbox');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-worldboot-2628-'));
test.after(() => { try { fs.rmSync(HOME, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* best effort */ } });

/* An ordinary install's launch environment -- no data, projects, workers or launch
   root set -- in a home of its own, with tmux stubbed (the fleet's terminals are
   never read) and the Claude config sandboxed (fixture discipline). */
function launchEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('AGENT_WORKFORCE_') || k === 'PORT' || k === 'KOSMOS_WORLD' || k === 'KOSMOS_PRE_WORLD_ROOTS') continue;
    env[k] = v;
  }
  return Object.assign(env, {
    HOME,
    USERPROFILE: HOME,
    APPDATA: path.join(HOME, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(HOME, 'AppData', 'Local'),
    AGENT_WORKFORCE_HOME: HOME,
    AGENT_WORKFORCE_TMUX_BIN: path.join(__dirname, 'test-support', 'fake-tmux.sh'),
    AGENT_WORKFORCE_CLAUDE_CONFIG: path.join(HOME, '.claude.json'),
    /* Belt and braces: no tmux write even to the stub. (AGENT_WORKFORCE_LAUNCH is
       deliberately NOT set: it is one of #634's four roots, so setting it alone
       would make this launch itself half-sandboxed and refused.) */
    AGENT_WORKFORCE_DRY_RUN: '1',
    PORT: '0',
  });
}

/* The named world, made active in the registry the board will read -- the same
   state POST /api/worlds/active leaves before the restart. */
const BASE = worlds.baseRoot(launchEnv());
const WORLD = worlds.createWorld(BASE, 'bootprobe');
worlds.setActiveWorld(BASE, WORLD.id);

test('#2628 CONTROL: the old audit, on the post-world environment, refuses this very setup', () => {
  const launch = launchEnv();
  assert.equal(sandbox.audit(launch).partial, false, 'the launch itself is an ordinary, unsandboxed install');
  const afterWorld = { ...launch };
  const applied = worlds.applyActiveWorldEnv(afterWorld, BASE);
  assert.ok(Object.keys(applied).length > 0, 'sanity: the named world moved the roots');
  assert.equal(sandbox.audit(afterWorld).partial, true,
    'the pre-fix audit read the post-world env and called a named world a half-sandbox');
});

test('#2628 A BOARD BOOTS INTO A NAMED WORLD, and serves it', async () => {
  const child = cp.spawn(process.execPath, [path.join(__dirname, 'server.js')],
    { cwd: __dirname, env: launchEnv(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no "Kosmos on" line within 60s; stderr: ' + err.slice(-1200))), 60000);
      child.stdout.on('data', () => {
        const m = /Kosmos on http:\/\/127\.0\.0\.1:(\d+)/.exec(out);
        if (m) { clearTimeout(timer); resolve(Number(m[1])); }
      });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error('the board exited ' + code + ' before listening; stderr: ' + err.slice(-1200))); });
    });
    assert.doesNotMatch(err, /half-sandboxed/, 'a named world is not a half-sandbox');
    const identity = await new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port, path: '/' }, (res) => { res.resume(); resolve(String(res.headers['x-kosmos-board'] || '')); })
        .on('error', () => resolve(''));
    });
    assert.ok(identity.endsWith('@' + WORLD.id), 'the board serves the named world it booted into: ' + JSON.stringify(identity));
    /* A named world is a REAL board, not a sandboxed fixture: its token is enforced
       (the token guard reads the same launch env as the boot guard). */
    const unauthenticated = await new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port, path: '/api/status' }, (res) => { res.resume(); resolve(res.statusCode); })
        .on('error', () => resolve(0));
    });
    assert.equal(unauthenticated, 403, 'the named world\'s board enforces its token');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const gone = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await gone;
    }
  }
});

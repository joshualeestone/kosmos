'use strict';

/**
 * #3660, end to end through the real server: Giddy Up on an install with a connected
 * model creates the setup guide ON that model; without the explicit test switch, a
 * dry-run board creates nothing (review round 2 measured test boards creating an
 * unasserted guide). RUNS THE REAL SERVER as a child process, every root sealed the
 * way server.projects.test.js seals them.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { stopBoard } = require('./test-support/board-child');

const REPO = __dirname;

function sandbox() {
  const sb = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-3660-')));
  const home = path.join(sb, 'home');
  fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
  // A signed-in default Claude account; the fake claude bin makes its liveness check pass.
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'guide-test@example.com' } }));
  fs.writeFileSync(path.join(sb, 'panes.txt'), '');
  return { sb, home, data: path.join(sb, 'data') };
}

function boot(box, extraEnv) {
  const child = spawn(process.execPath, [path.join(REPO, 'server.js')], {
    env: {
      PATH: process.env.PATH,
      HOME: box.home,
      PORT: '0',
      AGENT_WORKFORCE_HOME: box.home,
      AGENT_WORKFORCE_DATA: box.data,
      AGENT_WORKFORCE_WORKERS: path.join(box.sb, 'workers'),
      AGENT_WORKFORCE_LAUNCH: path.join(box.sb, 'launch'),
      AGENT_WORKFORCE_PROJECTS: path.join(box.sb, 'projects'),
      AGENT_WORKFORCE_CLAUDE_CONFIG: path.join(box.sb, 'claude-config.json'),
      AGENT_WORKFORCE_CLAUDE_BIN: '/bin/echo',
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
      AGENT_WORKFORCE_FAKE_PANES: path.join(box.sb, 'panes.txt'),
      AGENT_WORKFORCE_DRY_RUN: '1',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => { try { child.kill(); } catch { /* gone */ } reject(new Error('server never announced a port:\n' + out)); }, 15000);
    child.stdout.on('data', (b) => {
      out += b;
      const m = out.match(/http:\/\/[^\s]*?:(\d+)/);
      if (m) { clearTimeout(t); resolve({ child, base: `http://127.0.0.1:${m[1]}` }); }
    });
  });
}

const flagFile = (box) => path.join(box.data, 'Kosmos', 'setup-assistant.json');
const armFile = (box) => path.join(box.data, 'Kosmos', 'setup-assistant-armed.json');

async function waitFor(fn, ms) {
  const until = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > until) return null;
    await new Promise((r) => setTimeout(r, 100));
  }
}

test('#3660: Giddy Up with a connected model creates the setup guide on that model, once', async () => {
  const box = sandbox();
  let child;
  try {
    const booted = await boot(box, { AGENT_WORKFORCE_SETUP_GUIDE: 'on' });
    child = booted.child;
    const base = booted.base;
    assert.equal(fs.existsSync(flagFile(box)), false, 'CONTROL: no guide before Giddy Up (boot does not arm)');
    const r = await fetch(base + '/api/first-run/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 200);
    assert.ok(fs.existsSync(armFile(box)), 'Giddy Up did not arm the guide');
    const flag = await waitFor(() => (fs.existsSync(flagFile(box)) ? JSON.parse(fs.readFileSync(flagFile(box), 'utf8')) : null), 10000);
    assert.ok(flag, 'no guide was created after Giddy Up with a connected Claude account');
    assert.equal(flag.provider, 'anthropic', 'the guide was not created on the connected model');
    assert.equal(flag.via, 'first-run');
    assert.match(String(flag.name), /^josh$/i);
  } finally {
    if (child) await stopBoard(child);
    fs.rmSync(box.sb, { recursive: true, force: true });
  }
});

test('#3660: a dry-run board creates no guide unless a test turns it on, even after Giddy Up', async () => {
  const box = sandbox();
  let child;
  try {
    const booted = await boot(box, {});
    child = booted.child;
    const base = booted.base;
    const r = await fetch(base + '/api/first-run/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 200);
    assert.ok(fs.existsSync(armFile(box)), 'CONTROL: the install is armed, so only the dry-run default can be what stops it');
    await new Promise((res) => setTimeout(res, 2500));
    assert.equal(fs.existsSync(flagFile(box)), false, 'a test board created a guide nobody asked for');
  } finally {
    if (child) await stopBoard(child);
    fs.rmSync(box.sb, { recursive: true, force: true });
  }
});

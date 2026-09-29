'use strict';

/**
 * #4405, end to end through the real server: the Settings > Help switch (POST /api/settings
 * setupAssistant) makes the Kosmos Guide when it is switched ON and none is on this computer,
 * says why when it cannot (no model), makes nothing when it is switched OFF, and never makes a
 * second one while a guide exists. RUNS THE REAL SERVER as a child process (the harness is
 * server.guide-on-connect-3660.test.js's). First run is NOT completed, so the install is not
 * armed and only the switch can make a guide.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { stopBoard } = require('./test-support/board-child');

const REPO = __dirname;

function signIn(home) {
  // A signed-in default Claude account; the fake claude bin makes its liveness check pass.
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'guide-test@example.com' } }));
}

function sandbox({ signedIn = true } = {}) {
  const sb = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4405-')));
  const home = path.join(sb, 'home');
  fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
  if (signedIn) signIn(home);
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
      /* #4253: this env is built by hand, so NODE_TEST_CONTEXT does not reach the
         board and its install ping would go to installkosmos.com on every run. */
      AGENT_WORKFORCE_CREATED_URL: 'http://127.0.0.1:9/api/created',
      AGENT_WORKFORCE_FEEDBACK_URL: 'http://127.0.0.1:9/api/feedback',
      AGENT_WORKFORCE_COMMUNITY_URL: 'http://127.0.0.1:9/',
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

const save = (base, on) => fetch(base + '/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ setupAssistant: { on } }) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));

test('#4405: switched ON with no model, it says no-model and makes nothing; OFF never tries', async () => {
  const box = sandbox({ signedIn: false });
  let child;
  try {
    const booted = await boot(box, { AGENT_WORKFORCE_SETUP_GUIDE: 'on' });
    child = booted.child;
    const off = await save(booted.base, false);
    assert.equal(off.status, 200);
    assert.equal(off.body.guide, undefined, 'switching OFF tried to make a guide');
    const on = await save(booted.base, true);
    assert.equal(on.status, 200);
    assert.deepEqual(on.body.guide, { state: 'no-model', seeded: false }, JSON.stringify(on.body));
    assert.equal(on.body.setupAssistant.on, true);
    assert.equal(fs.existsSync(flagFile(box)), false, 'a guide was made with no model');
  } finally {
    if (child) await stopBoard(child);
    fs.rmSync(box.sb, { recursive: true, force: true });
  }
});

test('#4405: switched ON with a model and no guide, it makes the guide once; ON again with a guide on record makes nothing', async () => {
  const box = sandbox();
  let child;
  try {
    const booted = await boot(box, { AGENT_WORKFORCE_SETUP_GUIDE: 'on' });
    child = booted.child;
    assert.equal(fs.existsSync(armFile(box)), false, 'CONTROL: not armed, so only the switch can make it');
    const on = await save(booted.base, true);
    assert.equal(on.status, 200);
    assert.deepEqual(on.body.guide, { state: 'seeded', seeded: true }, JSON.stringify(on.body));
    const flag = JSON.parse(fs.readFileSync(flagFile(box), 'utf8'));
    assert.equal(flag.via, 'settings');
    assert.ok(fs.existsSync(armFile(box)), 'the switch did not arm the install');
    /* The dry-run create made no real folder. Give the recorded name a folder WITHOUT the guide's marker: another
       agent on the name, or the guide's folder having lost its marker. That is ambiguous, and a second guide must
       NOT be made there. */
    fs.mkdirSync(path.join(box.sb, 'workers', 'josh'), { recursive: true });
    const sg = await (await fetch(booted.base + '/api/setup-guide')).json();
    assert.equal(sg.reason, 'not-guide', 'CONTROL: the ambiguous state this arm is about: ' + JSON.stringify(sg));
    const again = await save(booted.base, true);
    assert.equal(again.status, 200);
    assert.deepEqual(again.body.guide, { state: 'unclear', seeded: false }, 'ON with a recorded guide in doubt did not say unclear: ' + JSON.stringify(again.body));
    assert.equal(JSON.parse(fs.readFileSync(flagFile(box), 'utf8')).at, flag.at, 'the guide record was rewritten');
  } finally {
    if (child) await stopBoard(child);
    fs.rmSync(box.sb, { recursive: true, force: true });
  }
});

test('#4405: a guide that was made and then REMOVED is put back by switching ON (restore), never made a second time', async () => {
  const box = sandbox();
  let child;
  try {
    // The state on disk: a guide recorded as made, its folder marked as the guide, and its name on the removed list.
    fs.mkdirSync(path.join(box.data, 'Kosmos'), { recursive: true });
    fs.writeFileSync(flagFile(box), JSON.stringify({ at: '2026-09-01T00:00:00.000Z', name: 'josh', via: 'first-run', provider: 'anthropic' }));
    const folder = path.join(box.sb, 'workers', 'josh');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, '.kosmos-setup-guide'), '');
    fs.writeFileSync(path.join(box.data, 'Kosmos', 'removed.json'), JSON.stringify([{ name: 'josh', removedAt: '2026-09-02T00:00:00.000Z' }]));
    const booted = await boot(box, { AGENT_WORKFORCE_SETUP_GUIDE: 'on' });
    child = booted.child;
    const sg = await (await fetch(booted.base + '/api/setup-guide')).json();
    assert.equal(sg.reason, 'none', 'CONTROL: a removed guide reads as none: ' + JSON.stringify(sg));
    const on = await save(booted.base, true);
    assert.equal(on.status, 200);
    assert.deepEqual(on.body.guide, { state: 'restored', seeded: true }, 'the removed guide was not restored: ' + JSON.stringify(on.body));
    /* 'restored' is restore's own outcome (a refused restore answers 'refused'); the test board runs dry, so restore
       reports what it would do and writes nothing, which is why the removed list is not read back here. */
    assert.equal(JSON.parse(fs.readFileSync(flagFile(box), 'utf8')).via, 'first-run', 'the guide record was rewritten: a second guide was made');
    assert.equal(fs.existsSync(path.join(box.sb, 'workers', 'josh-ai')), false, 'a second guide (Josh AI) was made');
  } finally {
    if (child) await stopBoard(child);
    fs.rmSync(box.sb, { recursive: true, force: true });
  }
});

test('#4405: a recorded guide whose folder is GONE from disk is NOT forgotten or made again: it says unclear', async () => {
  const box = sandbox();
  let child;
  try {
    fs.mkdirSync(path.join(box.data, 'Kosmos'), { recursive: true });
    fs.writeFileSync(flagFile(box), JSON.stringify({ at: '2026-09-01T00:00:00.000Z', name: 'josh', via: 'first-run', provider: 'anthropic' }));
    const booted = await boot(box, { AGENT_WORKFORCE_SETUP_GUIDE: 'on' });
    child = booted.child;
    const sg = await (await fetch(booted.base + '/api/setup-guide')).json();
    assert.equal(sg.reason, 'not-guide', 'CONTROL: a recorded guide with no folder reads not-guide: ' + JSON.stringify(sg));
    const on = await save(booted.base, true);
    assert.equal(on.status, 200);
    assert.deepEqual(on.body.guide, { state: 'unclear', seeded: false }, JSON.stringify(on.body));
    assert.equal(JSON.parse(fs.readFileSync(flagFile(box), 'utf8')).via, 'first-run', 'the record was forgotten or rewritten');
  } finally {
    if (child) await stopBoard(child);
    fs.rmSync(box.sb, { recursive: true, force: true });
  }
});

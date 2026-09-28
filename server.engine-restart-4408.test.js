'use strict';
/**
 * #4408 (an external tester on prod, 2026-09-28): a board running older code than is on disk offers ONE Restart Kosmos
 * button, and POST /api/engine/restart restarts it through engine/boardrestart, the path a world switch
 * uses. Its own file because it stubs boardrestart (no launchd, a fake installed CLI, a recording
 * spawner) and those stubs cannot be undone; node --test runs each file in its own process.
 */
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-engrestart-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-engrestart-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-engrestart-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-engrestart-launch-'));
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-engrestart-config-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
fs.writeFileSync(process.env.AGENT_WORKFORCE_FAKE_PANES, '');
process.env.AGENT_WORKFORCE_RELEASE_BASE = 'http://127.0.0.1:9/dist';
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const board = require('./engine/boardrestart');
const update = require('./engine/update');
const spawned = [];
board.setRunner(() => ({ ok: false, because: 'no such service' }));   // no launchd job: the kosmos CLI arm decides
board.setUid(() => 501);
let cli = '/fake/home/bin/kosmos';
board.setInstalledCli(() => cli);
board.setSpawner((cmd, args) => { spawned.push([cmd, ...args]); return { on() {}, unref() {} }; });

const srv = require('./server.js');
let server;
let base;
test.before(async () => { server = await srv.start(0); base = 'http://127.0.0.1:' + server.address().port; });
test.after(() => { try { server.close(); } catch { /* gone */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const status = async () => (await (await fetch(base + '/api/status')).json()).engine;
const post = async () => { const r = await fetch(base + '/api/engine/restart', { method: 'POST' }); return { status: r.status, body: await r.json() }; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('#4408: a current board is not restarted, and the page is told no button', async () => {
  const e = await status();
  assert.equal(e.staleSince, null);
  assert.equal(e.canRestart, false, 'a current board offered a restart');
  const r = await post();
  assert.equal(r.status, 409);
  assert.match(r.body.because, /already running the code on disk/);
  assert.equal(r.body.current, true, 'the page reads `current` to reload rather than matching the sentence');
  await wait(700);
  assert.deepEqual(spawned, [], 'a current board restarted itself');
});

/* The stubs above pin the Mac arms (launchctl, the installed CLI); on Windows canSelfRestart takes the logon-task
   arm and would ask the real schtasks, so the restart arm runs on the Mac only. */
test('#4408: a stale board that can restart itself says so, and the button runs `kosmos restart` once',
  { skip: process.platform === 'win32' && 'the Windows arm (schtasks) is not stubbed here' }, async () => {
  /* A throwaway module at the app root, never a real source file (server.test.js edits its own beside this). */
  /* At the app folder's root (still under the checked root), in its own folder no other suite walks. */
  const dir = path.join(__dirname, `.probe-restart-${process.pid}`);
  const probe = path.join(dir, 'x.js');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(probe, 'module.exports = 1;\n');
  try {
    require(probe);
    await wait(5200);        // a sweep remembers it as loaded
    await status();
    fs.writeFileSync(probe, 'module.exports = 2;\n');
    await wait(5200);
    const e = await status();
    assert.ok(e.staleSince, 'CONTROL: the edited module made the board stale');
    assert.deepEqual(e.changed, [path.basename(dir) + '/x.js'], 'the edited file is not named');
    assert.equal(e.canRestart, true, 'a stale board that can restart itself did not offer the button');

    /* An update between its file swap and its own restart reads stale; the button must not race it. */
    const installing = update.alreadyInstalling;
    update.alreadyInstalling = () => true;
    let mid;
    try { mid = await post(); } finally { update.alreadyInstalling = installing; }
    assert.equal(mid.status, 409);
    assert.equal(mid.body.updating, true, 'the page reads `updating` to wait for the installer\'s restart');
    await wait(700);
    assert.deepEqual(spawned, [], 'a restart raced an update that restarts the board itself');

    // CONTROL first: with no way to bring itself back, it refuses and spawns nothing.
    cli = null;
    const no = await post();
    assert.equal(no.status, 409);
    await wait(700);
    assert.deepEqual(spawned, [], 'a board that cannot come back was stopped anyway');

    cli = '/fake/home/bin/kosmos';
    const yes = await post();
    assert.equal(yes.status, 202);
    assert.equal(yes.body.restarting, true);
    const twice = await post();   // a second open page pressing too
    assert.equal(twice.status, 202);
    await wait(900);   // the restart runs after the response has flushed
    assert.deepEqual(spawned, [['/fake/home/bin/kosmos', 'restart']], 'not exactly one `kosmos restart` for two presses');
  } finally {
    delete require.cache[probe];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

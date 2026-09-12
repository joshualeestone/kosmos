'use strict';
/**
 * #1704 PR3: POST /api/worlds/active {id, agents: 'pause'|'keep'} -- the route half
 * of "the switch dialog asks each time" (Josh).
 *
 * The Mac arm is stated through worldstarts.setPlatformForTests and driven by
 * remove.setRunner, so it runs identically on either kind of host and never reaches
 * a real launchd job or tmux session. boardrestart is mocked so no switch here ever
 * restarts anything. Live execution is armed per test and closed after, since
 * worldstarts refuses without it (one test proves the refusal).
 *
 *   node --test server.world-switch-agents-1704.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-switch-agents-1704-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');

const boardrestart = require('./engine/boardrestart');
const liveExec = require('./engine/live-execution');
const remove = require('./engine/remove');
const create = require('./engine/create');
const worlds = require('./engine/worlds');
const worldstarts = require('./engine/worldstarts');
const worldenv = require('./engine/worldenv');
const fleet = require('./test-support/fleet');
const { start, server } = require('./server');

if (typeof process.getuid !== 'function') process.getuid = () => 501;

const origCanSelfRestart = boardrestart.canSelfRestart;
const origSelfRestart = boardrestart.selfRestart;
boardrestart.canSelfRestart = () => ({ canRestart: false, because: 'mock: never restart in this suite' });
boardrestart.selfRestart = () => ({ ok: true });

let calls = [];
let failing = [];
let recordAtFirstCommand;
let macSwitchedOff = new Set();   // agents launchd reports switched off (create.disabledJobs)
function runner(file, args) {
  const line = [nodePath.basename(file), ...args].join(' ');
  if (recordAtFirstCommand === undefined) {
    recordAtFirstCommand = fs.existsSync(worldstarts.RECORD_FILE)
      ? JSON.parse(fs.readFileSync(worldstarts.RECORD_FILE, 'utf8')) : null;
  }
  calls.push(line);
  if (args[0] === 'has-session') return { ok: false, code: 1 };
  if (failing.some((f) => line.includes(f))) return { ok: false, code: 9 };
  return { ok: true, stdout: '' };
}

let base;
let board;
const post = (obj) => fetch(base + '/api/worlds/active', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj),
}).then(async (r) => ({ status: r.status, body: await r.json() }));
const activeWorldId = () => worlds.activeWorld(worlds.baseRoot(process.env)).id;
const record = () => (fs.existsSync(worldstarts.RECORD_FILE)
  ? JSON.parse(fs.readFileSync(worldstarts.RECORD_FILE, 'utf8')).entries : null);

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await fetch(base + '/api/worlds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Alpha World' }) });
  worldstarts.setPlatformForTests('darwin');
  remove.setRunner(runner);
  // create.disabledJobs (launchd's per-user overrides) goes through create's own
  // runner: answer "nothing is switched off" rather than reach a real launchctl.
  create.setRunner((file, args) => ({
    ok: true,
    stdout: args[0] === 'print-disabled'
      ? [...macSwitchedOff].map((n) => `\t"${create.serviceLabel(n)}" => disabled`).join('\n') : '',
  }));
  fs.mkdirSync(nodePath.dirname(create.plistPath('ava')), { recursive: true });
  fs.writeFileSync(create.plistPath('ava'), '<plist/>');
  board = fleet.install([fleet.agent('ava', { state: 'idle' })]);
});
test.beforeEach(() => {
  calls = []; failing = []; recordAtFirstCommand = undefined; macSwitchedOff = new Set();
  liveExec.allowLiveExecution();
  fs.rmSync(worldstarts.RECORD_FILE, { force: true });
});
test.after(() => {
  if (board) board.restore();
  remove.resetForTests();
  create.setRunner(null);
  worldstarts.setPlatformForTests(null);
  liveExec.resetForTests();
  boardrestart.canSelfRestart = origCanSelfRestart;
  boardrestart.selfRestart = origSelfRestart;
  try { server.close(); } catch { /* best effort */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

test('a junk agents value is a 400 with a sentence, and nothing is switched or stopped', async () => {
  const before = activeWorldId();
  for (const junk of ['stop', 'PAUSE', 5, null, ['pause']]) {
    const r = await post({ id: 'alphaworld', agents: junk });
    assert.equal(r.status, 400, `agents=${JSON.stringify(junk)} must be refused`);
    assert.match(r.body.because, /pause .* or keep them running/);
  }
  assert.equal(activeWorldId(), before, 'a refused request moved the active world');
  assert.deepEqual(calls, []);
});

test('an ABSENT agents value means keep: today\'s switch, no stop, and the new fields say so', async () => {
  const r = await post({ id: 'alphaworld' });
  assert.equal(r.status, 200);
  assert.equal(r.body.agents, 'keep');
  assert.deepEqual(r.body.paused, []);
  assert.deepEqual(r.body.notPaused, []);
  assert.equal(r.body.restartRequired, true);
  assert.deepEqual(calls, [], 'keep must not touch a single agent');
});

test('pause on a REAL switch: the agent is recorded BEFORE the first stop, then stopped, and reported paused', async () => {
  const r = await post({ id: 'alphaworld', agents: 'pause' });
  assert.equal(r.status, 200);
  assert.equal(r.body.agents, 'pause');
  assert.deepEqual(r.body.paused, ['ava']);
  assert.deepEqual(r.body.notPaused, []);
  assert.ok(recordAtFirstCommand, 'no record existed when the first stop command ran -- the write is not ahead of the stop');
  assert.deepEqual(recordAtFirstCommand.entries.map((e) => e.name), ['ava']);
  assert.equal(calls[0], `launchctl disable gui/${process.getuid()}/${create.serviceLabel('ava')}`);
  assert.ok(calls.includes(`launchctl bootout gui/${process.getuid()}/${create.serviceLabel('ava')}`));
  assert.deepEqual(record().map((e) => e.name), ['ava'], 'the paused agent stays on record for the boot drain');
});

test('pause on a NO-OP switch (the booted world) stops nothing', async () => {
  const r = await post({ id: 'default', agents: 'pause' });
  assert.equal(r.status, 200);
  assert.equal(r.body.restartRequired, false);
  assert.deepEqual(r.body.paused, []);
  assert.deepEqual(calls, [], 'a switch to the world already serving must not pause its agents');
});

test('a stop that fails puts the agent in notPaused, with its disable undone and no record', async () => {
  failing = ['bootout'];
  const r = await post({ id: 'alphaworld', agents: 'pause' });
  assert.equal(r.status, 200, 'a partial pause still switches; the agent keeps running');
  assert.deepEqual(r.body.paused, []);
  assert.equal(r.body.notPaused.length, 1);
  assert.equal(r.body.notPaused[0].name, 'ava');
  assert.match(r.body.notPaused[0].because, /keeps running/);
  assert.ok(calls.some((c) => c.startsWith('launchctl enable')), 'the disable was not undone');
  assert.deepEqual(record(), []);
});

test('when recording the switch fails, the agents just paused are started again (rollback)', async () => {
  const lock = nodePath.join(worlds.baseRoot(process.env), '.worlds.json.lock');
  fs.mkdirSync(lock, { recursive: true });
  try {
    const r = await post({ id: 'alphaworld', agents: 'pause' });
    assert.equal(r.status, 409, 'the classified lock error is still what the caller gets');
    assert.match(r.body.because, /in progress/);
  } finally {
    fs.rmdirSync(lock);
  }
  const label = `gui/${process.getuid()}/${create.serviceLabel('ava')}`;
  const disabledAt = calls.indexOf(`launchctl disable ${label}`);
  const enabledAt = calls.indexOf(`launchctl enable ${label}`);
  assert.ok(disabledAt >= 0, 'the pause never ran, so this test proved nothing');
  assert.ok(enabledAt > disabledAt, 'the paused agent was not set to start again after the failed switch');
  assert.ok(calls.includes(`launchctl bootstrap gui/${process.getuid()} ${create.plistPath('ava')}`), 'and not started again now');
  assert.deepEqual(record(), [], 'a rolled-back agent must not stay listed as paused');
});

test('with live execution OFF a pause refuses: nothing stopped, every agent in notPaused, the switch proceeds', async () => {
  liveExec.resetForTests();
  const r = await post({ id: 'alphaworld', agents: 'pause' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.paused, []);
  assert.deepEqual(r.body.notPaused.map((n) => n.name), ['ava']);
  assert.match(r.body.notPaused[0].because, /not allowed to start or stop agents/);
  assert.deepEqual(calls, []);
  assert.equal(record(), null, 'a refused pause writes nothing');
});

/* ── review round 1 ───────────────────────────────────────────────────── */

// The route and namedWorldSpawnRefusal both read worldenv.bootedWorld at call time,
// so patching the cached module's export makes this board "booted into" a world.
async function bootedInto(worldId, fn) {
  const real = worldenv.bootedWorld;
  worldenv.bootedWorld = () => worldId;
  try { return await fn(); } finally { worldenv.bootedWorld = real; }
}
const seedPaused = (names) => {
  fs.mkdirSync(nodePath.dirname(worldstarts.RECORD_FILE), { recursive: true });
  fs.writeFileSync(worldstarts.RECORD_FILE, JSON.stringify({ entries: names.map((name) => ({ name, why: 'paused', at: new Date().toISOString() })) }));
};

test('R1-1: a pause from a NAMED Kosmos (agents may not run there, #2849) stops nothing, lists everyone, and still switches', async () => {
  const r = await bootedInto('alphaworld', () => post({ id: 'default', agents: 'pause' }));
  assert.equal(r.status, 200, 'the switch must still proceed');
  assert.equal(r.body.restartRequired, true, 'the control: this was a REAL switch, where a pause would otherwise run');
  assert.deepEqual(r.body.paused, []);
  assert.deepEqual(r.body.notPaused.map((n) => n.name), ['ava']);
  assert.match(r.body.notPaused[0].because, /cannot be paused from a named Kosmos/);
  assert.deepEqual(calls, [], 'on a Mac this would stop the DEFAULT Kosmos\'s agents and strand them');
  assert.equal(record(), null, 'nothing may be recorded into the named world\'s store');
  assert.equal(activeWorldId(), 'default');
});

test('R1-5: a switch to the booted world resumes this world\'s paused agents (enable, then start)', async () => {
  seedPaused(['ava']);
  const r = await post({ id: 'default', agents: 'keep' });
  assert.equal(r.status, 200);
  assert.equal(r.body.restartRequired, false, 'the control: a no-op switch');
  assert.deepEqual(calls, [
    `launchctl enable gui/${process.getuid()}/${create.serviceLabel('ava')}`,
    `launchctl bootstrap gui/${process.getuid()} ${create.plistPath('ava')}`,
  ]);
  assert.deepEqual(record(), [], 'a resumed agent is cleared');
});

test('R1-5: that resume is held while agents may not start in the booted world (#2849)', async () => {
  seedPaused(['ava']);
  const r = await bootedInto('alphaworld', () => post({ id: 'alphaworld', agents: 'keep' }));
  assert.equal(r.status, 200);
  assert.equal(r.body.restartRequired, false, 'the control: a no-op switch');
  assert.deepEqual(calls, [], 'a held agent must not be enabled or started');
  const entries = record();
  assert.deepEqual(entries.map((e) => e.name), ['ava'], 'the entry stays, for when the rule is lifted');
  assert.match(entries[0].because, /named world/);
});

/* ── review round 3 ───────────────────────────────────────────────────── */

test('R3: the rollback starts only what THIS request stopped, never an agent an earlier pause-switch stopped', async () => {
  seedPaused(['ava']);            // an earlier pause-switch of this Kosmos...
  macSwitchedOff.add('ava');      // ...left its job switched off
  const lock = nodePath.join(worlds.baseRoot(process.env), '.worlds.json.lock');
  fs.mkdirSync(lock, { recursive: true });
  let r;
  try {
    r = await post({ id: 'alphaworld', agents: 'pause' });
  } finally {
    fs.rmdirSync(lock);
  }
  assert.equal(r.status, 409, 'the control: the switch failed, so the rollback ran');
  assert.equal(calls.some((c) => c.startsWith('launchctl enable') || c.startsWith('launchctl bootstrap')), false,
    'the rollback started an agent the person had asked, twice, to keep paused');
  assert.deepEqual(record().map((e) => e.name), ['ava'], 'the earlier pause entry must be KEPT, not dropped, by a rollback that did not stop it');
});

test('R3: a pause from a named Kosmos with an unreadable roster is the same 503, not a silent empty list', async () => {
  const before = activeWorldId();
  const blind = fleet.blind();
  try {
    const r = await bootedInto('alphaworld', () => post({ id: 'default', agents: 'pause' }));
    assert.equal(r.status, 503);
    assert.match(r.body.because, /could not see which agents are running/);
    assert.equal(activeWorldId(), before, 'a 503 must not switch');
  } finally {
    blind.restore();
    board = fleet.install([fleet.agent('ava', { state: 'idle' })]);
  }
  assert.deepEqual(calls, []);
});

test('a pause for a Kosmos that does not exist is a 404 before anything is stopped', async () => {
  const r = await post({ id: 'no-such-world-xyz', agents: 'pause' });
  assert.equal(r.status, 404);
  assert.deepEqual(calls, []);
});

'use strict';
/**
 * #2935: POST /api/worlds/hide {id} -- Josh's soft-delete ruling (hide a Kosmos from the list, keep
 * the on-disk store). The engine `hideWorld` is unit-tested in engine.worlds-hide-2935.test.js; this
 * covers the ROUTE: its status classification (mirroring /api/worlds/rename) and the best-effort,
 * reversible agent-stop it fires -- the hidden world's agents are DISABLED + BOOTED OUT and their
 * session ended, never deleted, and a stop failure never fails the hide.
 *
 * Like the switch-agents suite, the Mac arm is driven by remove.setRunner so it never reaches a real
 * launchd job or tmux session, and the launch/data roots are redirected under a sandbox.
 *
 *   node --test server.worlds-hide-2935.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-worlds-hide-2935-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');

const remove = require('./engine/remove');
const create = require('./engine/create');
const store = require('./engine/store');
const worlds = require('./engine/worlds');
const { start, server } = require('./server');

if (typeof process.getuid !== 'function') process.getuid = () => 501;

let calls = [];
let failing = [];
function runner(file, args) {
  const line = [nodePath.basename(file), ...args].join(' ');
  calls.push(line);
  if (args[0] === 'has-session') return { ok: false, code: 1 };
  if (failing.some((f) => line.includes(f))) return { ok: false, code: 9 };
  return { ok: true, stdout: '' };
}

let base;
const hide = (obj) => fetch(base + '/api/worlds/hide', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj),
}).then(async (r) => ({ status: r.status, body: await r.json() }));
const registryBase = () => worlds.baseRoot(process.env);
const listIds = () => worlds.listWorlds(registryBase()).map((w) => w.id);
const rowIds = () => worlds.readRegistry(registryBase()).worlds.map((w) => w.id);

/* Seed a NAMED world with one agent that has a profile (so worldProfileNames sees it) and a keyed
   plist on disk (so remove.jobFor resolves its job). Returns the world's id. */
function seedNamedWorldWithAgent(name, agent) {
  const b = registryBase();
  const world = worlds.createWorld(b, name);
  const profiles = worlds.worldProfilesDir(b, world);
  fs.mkdirSync(profiles, { recursive: true });
  fs.writeFileSync(nodePath.join(profiles, store.profileFileName(agent)), JSON.stringify({ name: agent, displayName: agent }));
  const plist = create.plistPath(agent, world.id);
  fs.mkdirSync(nodePath.dirname(plist), { recursive: true });
  fs.writeFileSync(plist, '<plist/>');
  return world.id;
}

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  remove.setRunner(runner);
});
test.beforeEach(() => { calls = []; failing = []; });
test.after(() => {
  remove.resetForTests();
  try { server.close(); } catch { /* best effort */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

test('hiding a named Kosmos drops it from the list, keeps its registry row, and STOPS its agent (disable + bootout + end session)', async () => {
  const id = seedNamedWorldWithAgent('Client Work', 'bo');
  assert.ok(listIds().includes(id), 'the world was not created');

  const r = await hide({ id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.equal(r.body.world.id, id);
  assert.ok(r.body.world.hiddenAt, 'the response world carries no hiddenAt');

  // Dropped from the user-facing list, but the row (the store pointer) survives.
  assert.ok(!listIds().includes(id), 'the hidden world is still listed');
  assert.ok(rowIds().includes(id), 'the registry row was dropped, so the promised file pointer is lost');

  // The agent was stopped on its WORLD-KEYED identity: disable first, then bootout, then its session.
  const label = `gui/${process.getuid()}/com.kosmos.agent.bo+${id}`;
  const disableAt = calls.indexOf(`launchctl disable ${label}`);
  const bootoutAt = calls.indexOf(`launchctl bootout ${label}`);
  assert.ok(disableAt >= 0, 'the agent was not disabled: ' + JSON.stringify(calls));
  assert.ok(bootoutAt > disableAt, 'bootout did not follow disable: ' + JSON.stringify(calls));
  assert.ok(calls.some((c) => c.endsWith(`kill-session -t =bo+${id}`)), 'the agent session was not ended: ' + JSON.stringify(calls));
  assert.deepEqual(r.body.agents.stopped, ['bo']);
  assert.deepEqual(r.body.agents.kept, []);
});

test('a stop that fails still hides the Kosmos (the agent-stop can never fail the hide)', async () => {
  const id = seedNamedWorldWithAgent('Second Space', 'cy');
  failing = ['bootout'];   // the stop cannot complete
  const r = await hide({ id });
  assert.equal(r.status, 200, 'a failed agent-stop must not fail the hide');
  assert.equal(r.body.world.id, id);
  assert.ok(!listIds().includes(id), 'the world was hidden regardless of the stop outcome');
  assert.deepEqual(r.body.agents.stopped, [], 'a failed bootout must not report the agent stopped');
  assert.deepEqual(r.body.agents.kept, ['cy']);
});

test('the default Kosmos cannot be hidden: 400, and it stays listed', async () => {
  const r = await hide({ id: 'default' });
  assert.equal(r.status, 400);
  assert.match(r.body.because, /first Kosmos cannot be hidden/);
  assert.ok(listIds().includes('default'), 'the default was hidden');
  assert.deepEqual(calls, [], 'a refused hide must not touch an agent');
});

test('the active Kosmos cannot be hidden: 409, switch away first', async () => {
  const id = seedNamedWorldWithAgent('Active One', 'dee');
  worlds.setActiveWorld(registryBase(), id);
  try {
    const r = await hide({ id });
    assert.equal(r.status, 409);
    assert.match(r.body.because, /switch to another Kosmos/i);
    assert.ok(listIds().includes(id), 'a refused hide dropped the world from the list');
    assert.deepEqual(calls, [], 'a refused hide must not touch an agent');
  } finally {
    worlds.setActiveWorld(registryBase(), 'default');
  }
});

test('hiding a Kosmos that does not exist is a 404', async () => {
  const r = await hide({ id: 'no-such-world-xyz' });
  assert.equal(r.status, 404);
  assert.deepEqual(calls, []);
});

test('a request with no id is a 400', async () => {
  const r = await hide({});
  assert.equal(r.status, 400);
  assert.match(r.body.because, /say which Kosmos/i);
  assert.deepEqual(calls, []);
});

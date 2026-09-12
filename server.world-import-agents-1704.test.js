'use strict';
/**
 * #1704 PR4: the import routes over HTTP against a real sandboxed board --
 * POST /api/worlds/import (the settings cog), POST /api/worlds {importAgents} (the
 * New Kosmos step), and GET /api/worlds/list (what both panes draw from).
 *
 * The first start of an imported agent is `create.installJob`; it is replaced here
 * with a recorder, so the suite asserts what the start was HANDED (the launch spec)
 * and never registers a real job. The Mac arm is stated through
 * worldstarts.setPlatformForTests and remove.setRunner, as the switch suite does,
 * and win32job is answered "no such task", so the source-job read is the same on
 * any host. Live execution is armed per test; one test proves the refusal.
 *
 *   node --test server.world-import-agents-1704.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-import-agents-1704-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');

const liveExec = require('./engine/live-execution');
const remove = require('./engine/remove');
const create = require('./engine/create');
const win32job = require('./engine/win32job');
const worlds = require('./engine/worlds');
const worldstarts = require('./engine/worldstarts');
const fleet = require('./test-support/fleet');
const { start, server } = require('./server');

if (typeof process.getuid !== 'function') process.getuid = () => 501;

const realInstallJob = create.installJob;
let installs = [];
let base;
let board;

const B = () => worlds.baseRoot(process.env);
const worldById = (id) => worlds.listWorlds(B()).find((w) => w.id === id);
const post = (p, obj) => fetch(base + p, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: typeof obj === 'string' ? obj : JSON.stringify(obj),
}).then(async (r) => ({ status: r.status, body: await r.json() }));
const recordOf = (id) => {
  const file = worldstarts.recordFileIn(worlds.worldStoreRoot(B(), worldById(id)));
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).entries : [];
};
function seed(worldId, name, o = {}) {
  const w = worldById(worldId);
  const profiles = worlds.worldProfilesDir(B(), w);
  fs.mkdirSync(profiles, { recursive: true });
  fs.writeFileSync(nodePath.join(profiles, name + '.json'), JSON.stringify(o.profile || { displayName: name.charAt(0).toUpperCase() + name.slice(1) }));
  const folder = nodePath.join(worlds.worldWorkersDir(B(), w), name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(nodePath.join(folder, o.briefName || 'CLAUDE.md'), `# ${name}\n`);
}
const profileIn = (worldId, name) => nodePath.join(worlds.worldProfilesDir(B(), worldById(worldId)), name + '.json');

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await post('/api/worlds', { name: 'Alpha World' });
  create.installJob = (name, opts) => { installs.push({ name, opts }); return { ok: true, started: true, because: 'set up and started now' }; };
  worldstarts.setPlatformForTests('darwin');
  remove.setRunner(() => ({ ok: true, stdout: '' }));
  win32job.setRunner(() => ({ ok: false, out: 'ERROR: The system cannot find the file specified.' }));
  board = fleet.install([fleet.agent('probe', { state: 'idle' })]);
});
test.beforeEach(() => {
  installs = [];
  liveExec.allowLiveExecution();
});
test.after(() => {
  create.installJob = realInstallJob;
  if (board) board.restore();
  remove.resetForTests();
  win32job.setRunner(null);
  worldstarts.setPlatformForTests(null);
  liveExec.resetForTests();
  try { server.close(); } catch { /* best effort */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

test('validation: an unreadable body, no Kosmos, no agents, a malformed list and an unknown Kosmos are refused with a sentence', async () => {
  assert.equal((await post('/api/worlds/import', '{ not json')).status, 400);
  const noId = await post('/api/worlds/import', { importAgents: [{ from: 'alphaworld', name: 'x' }] });
  assert.equal(noId.status, 400);
  assert.match(noId.body.because, /say which Kosmos to add agents to/);
  const none = await post('/api/worlds/import', { id: 'default', importAgents: [] });
  assert.equal(none.status, 400);
  assert.match(none.body.because, /choose at least one agent/);
  const absent = await post('/api/worlds/import', { id: 'default' });
  assert.equal(absent.status, 400, 'a request that names no agents at all adds nothing');
  for (const bad of ['ava', [{ from: 'alphaworld' }], [null]]) {
    const r = await post('/api/worlds/import', { id: 'default', importAgents: bad });
    assert.equal(r.status, 400, `importAgents=${JSON.stringify(bad)}`);
    assert.match(r.body.because, /say which agents to add/);
  }
  const unknown = await post('/api/worlds/import', { id: 'no-such-world', importAgents: [{ from: 'alphaworld', name: 'x' }] });
  assert.equal(unknown.status, 404);
  assert.match(unknown.body.because, /no Kosmos with that id/);
  assert.deepEqual(installs, []);
});

test('a malformed New Kosmos import creates no Kosmos at all', async () => {
  const r = await post('/api/worlds', { name: 'Never Made', importAgents: [{ from: 'default' }] });
  assert.equal(r.status, 400);
  assert.equal(worldById('nevermade'), undefined, 'the Kosmos was created before its request was validated');
});

test('refusals over HTTP: the same Kosmos, a name already there, an unknown source -- a 409 when nothing was added', async () => {
  const same = await post('/api/worlds/import', { id: 'alphaworld', importAgents: [{ from: 'alphaworld', name: 'x' }] });
  assert.equal(same.status, 409);
  assert.equal(same.body.because, 'x was not added: it is already in Alpha World');

  seed('alphaworld', 'kit');
  seed('default', 'kit', { profile: { displayName: 'Our Kit' } });
  const taken = await post('/api/worlds/import', { id: 'default', importAgents: [{ from: 'alphaworld', name: 'kit' }] });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.because, 'kit was not added: Kosmos 1 already has an agent called kit');
  assert.equal(JSON.parse(fs.readFileSync(profileIn('default', 'kit'), 'utf8')).displayName, 'Our Kit', 'the agent already there was changed');

  const two = await post('/api/worlds/import', { id: 'default', importAgents: [{ from: 'nope', name: 'a1' }, { from: 'nope', name: 'a2' }] });
  assert.equal(two.status, 409);
  assert.equal(two.body.because, 'none of those agents could be added');
  assert.deepEqual(two.body.imported.refused.map((x) => x.because), ['there is no Kosmos with that id on this machine', 'there is no Kosmos with that id on this machine']);
  assert.deepEqual(installs, [], 'a refused import started something');
});

test('into the Kosmos that is open: copied, and started now through installJob with the launch spec', async () => {
  seed('alphaworld', 'ava');
  seed('alphaworld', 'cody', { profile: { displayName: 'Cody', provider: 'openai' }, briefName: 'AGENTS.md' });
  const r = await post('/api/worlds/import', { id: 'default', importAgents: [{ from: 'alphaworld', name: 'ava' }, { from: 'alphaworld', name: 'cody' }] });
  assert.equal(r.status, 200, r.body.because);
  assert.deepEqual(r.body.imported.copied, [
    { from: 'alphaworld', name: 'ava', displayName: 'Ava' },
    { from: 'alphaworld', name: 'cody', displayName: 'Cody' },
  ]);
  assert.deepEqual(r.body.imported.started, ['ava', 'cody']);
  assert.deepEqual(r.body.imported.waiting, []);
  assert.deepEqual(r.body.imported.later, []);
  assert.deepEqual(installs, [
    { name: 'ava', opts: { platform: 'darwin' } },
    { name: 'cody', opts: { platform: 'darwin', runner: 'codex' } },
  ]);
  assert.ok(fs.existsSync(profileIn('default', 'ava')));
  assert.ok(fs.existsSync(nodePath.join(process.env.AGENT_WORKFORCE_WORKERS, 'cody', 'AGENTS.md')));
  assert.deepEqual(recordOf('default').filter((e) => ['ava', 'cody'].includes(e.name)), [], 'a started agent stays on the list to start');
});

test('into a named Kosmos that is not open: recorded there and shown waiting with the #2849 sentence; nothing starts', async () => {
  seed('default', 'dan');
  const r = await post('/api/worlds/import', { id: 'alphaworld', importAgents: [{ from: 'default', name: 'dan' }] });
  assert.equal(r.status, 200, r.body.because);
  assert.deepEqual(r.body.imported.started, []);
  assert.deepEqual(r.body.imported.later, []);
  assert.equal(r.body.imported.waiting.length, 1);
  assert.equal(r.body.imported.waiting[0].name, 'dan');
  assert.match(r.body.imported.waiting[0].because, /^Agents do not run in a named Kosmos yet/);
  assert.deepEqual(installs, [], 'the one spawn rule was bypassed');
  assert.deepEqual(recordOf('alphaworld').filter((e) => e.name === 'dan').map((e) => e.why), ['imported'], 'the wait was not recorded for that Kosmos');

  const list = await fetch(base + '/api/worlds/list').then((x) => x.json());
  const alpha = list.worlds.find((w) => w.id === 'alphaworld');
  const dan = alpha.waiting.find((w) => w.name === 'dan');
  assert.ok(dan, 'the waiting agent is not listed for its Kosmos');
  assert.equal(dan.displayName, 'Dan', 'the pane would speak the machine name');
  assert.match(dan.because, /^Agents do not run in a named Kosmos yet/, 'the pane would say it starts when opened, which it will not');
});

test('live execution OFF: copied and recorded, not started, and the sentence says why', async () => {
  seed('alphaworld', 'eve');
  liveExec.resetForTests();
  const r = await post('/api/worlds/import', { id: 'default', importAgents: [{ from: 'alphaworld', name: 'eve' }] });
  assert.equal(r.status, 200, r.body.because);
  assert.deepEqual(r.body.imported.started, []);
  assert.deepEqual(r.body.imported.waiting.map((w) => w.name), ['eve']);
  assert.match(r.body.imported.waiting[0].because, /not allowed to start agents from here/);
  assert.deepEqual(installs, []);
  assert.ok(fs.existsSync(profileIn('default', 'eve')), 'the copy is made either way');
  assert.deepEqual(recordOf('default').filter((e) => e.name === 'eve').map((e) => e.why), ['imported'], 'it must stay recorded for the next boot');
});

test('the New Kosmos step: a create with importAgents copies them in, and says they wait (a new Kosmos is a named one)', async () => {
  seed('default', 'fay');
  const r = await post('/api/worlds', { name: 'Gamma', importAgents: [{ from: 'default', name: 'fay' }] });
  assert.equal(r.status, 200, r.body.because);
  assert.equal(r.body.world.id, 'gamma');
  assert.deepEqual(r.body.imported.copied.map((c) => c.name), ['fay']);
  assert.deepEqual(r.body.imported.waiting.map((w) => w.name), ['fay']);
  assert.ok(fs.existsSync(profileIn('gamma', 'fay')));
  assert.deepEqual(installs, []);
});

test('a page from before still works: importAgentsFrom brings every agent that Kosmos can offer', async () => {
  seed('alphaworld', 'gus');
  const r = await post('/api/worlds', { name: 'Delta', importAgentsFrom: ['alphaworld'] });
  assert.equal(r.status, 200, r.body.because);
  const names = r.body.imported.copied.map((c) => c.name);
  assert.ok(names.includes('gus'), 'a legacy import did not copy the Kosmos\'s agents: ' + JSON.stringify(r.body.imported));
  assert.ok(r.body.imported.copied.every((c) => c.from === 'alphaworld'));
});

test('R1 (C): a page from before gets the counts it reads -- failed and unknownSources -- so it cannot close over a refusal', async () => {
  seed('alphaworld', 'x');   // one character: not a name a job can be built from
  const r = await post('/api/worlds', { name: 'Epsilon', importAgentsFrom: ['alphaworld', 'nope'] });
  assert.equal(r.status, 200, r.body.because);
  assert.equal(r.body.imported.unknownSources, 1);
  assert.equal(typeof r.body.imported.failed, 'number');
  assert.ok(r.body.imported.failed >= 1, 'an agent that could not be offered was dropped rather than refused');
  assert.ok(r.body.imported.refused.some((x) => x.name === 'x' && /name cannot be used/.test(x.because)));
  const plain = await post('/api/worlds/import', { id: 'default', importAgents: [{ from: 'nope', name: 'zz' }] });
  assert.equal('failed' in plain.body.imported, false, 'the per-agent form keeps its own shape');
});

test('R1: more picks than one request may carry is a 400 with a sentence', async () => {
  const many = Array.from({ length: 101 }, (_, i) => ({ from: 'alphaworld', name: 'a' + i }));
  const r = await post('/api/worlds/import', { id: 'default', importAgents: many });
  assert.equal(r.status, 400);
  assert.match(r.body.because, /add at most 100 agents at a time/);
});

test('R1 (A): an import the start CLEARED is reported, never counted as simply added', async () => {
  seed('alphaworld', 'zoe');
  const real = worldstarts.startImported;
  worldstarts.startImported = () => ({ resumed: [], held: [], cleared: ['zoe'] });   // a removal landing between copy and start
  try {
    const r = await post('/api/worlds/import', { id: 'default', importAgents: [{ from: 'alphaworld', name: 'zoe' }] });
    assert.equal(r.status, 200, r.body.because);
    assert.deepEqual(r.body.imported.started, []);
    assert.deepEqual(r.body.imported.waiting.map((w) => w.name), ['zoe'], 'a cleared import vanished from the answer');
    assert.match(r.body.imported.waiting[0].because, /list of removed agents, so it was not started/);
  } finally {
    worldstarts.startImported = real;
  }
});

test('GET /api/worlds/list: every Kosmos, its agents to pick from (removed ones left out), and what waits in it', async () => {
  seed('default', 'hal');
  seed('default', 'ivy');
  fs.writeFileSync(remove.REMOVED_FILE, JSON.stringify([{ name: 'ivy' }]));
  try {
    const list = await fetch(base + '/api/worlds/list').then((x) => x.json());
    for (const w of list.worlds) {
      assert.ok(typeof w.id === 'string' && typeof w.name === 'string');
      assert.ok(Array.isArray(w.agents) && Array.isArray(w.waiting));
      assert.equal(w.agentCount, w.agents.length);
    }
    const def = list.worlds.find((w) => w.id === 'default');
    assert.ok(def.agents.some((a) => a.name === 'hal' && a.displayName === 'Hal' && a.because === null));
    assert.equal(def.agents.some((a) => a.name === 'ivy'), false, 'a removed agent was offered');
  } finally {
    fs.rmSync(remove.REMOVED_FILE, { force: true });
  }
});

'use strict';

/**
 * #3564 swarm routes through the real server (in-process, every root sandboxed, dry run):
 * the settings PUT (checked, only for a swarm, rewrites the lead's block on a new count),
 * Stop now (paused "stopped" even when the interrupt cannot be confirmed, and says so),
 * and On/Off per project (only a swarm that is a member).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-swarm-route-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./engine/store');
const create = require('./engine/create');
const swarm = require('./engine/swarm');
const projects = require('./engine/projects');
const { start, server } = require('./server');

function lead(name, profile) {
  const dir = create.workerDir(name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `# ${name}\n\n${swarm.START}\n${swarm.blockBody(3)}\n${swarm.END}\n`);
  store.writeProfile(name, profile);
}

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  try { server.close(); } catch { /* best effort */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const put = (p, body) => fetch(base + p, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });

test('#3564 settings: checked, only for a swarm, and a new count is written into the lead\'s own instructions', async () => {
  lead('hive', swarm.birthProfile({ maxHelpers: 3, dailyTokenLimit: 1000 }));
  lead('solo', { role: 'pm' });
  const r = await put('/api/agent/hive/swarm', { maxHelpers: 7, dailyTokenLimit: 5000 });
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.swarm.maxHelpers, 7);
  assert.equal(b.told.state, projects.TOLD.TOLD);
  assert.match(fs.readFileSync(path.join(create.workerDir('hive'), 'CLAUDE.md'), 'utf8').replace(/\s+/g, ' '), /at most 7 at once/);
  assert.deepEqual(swarm.settingsOf(store.readProfile('hive')).dailyTokenLimit, 5000);
  assert.equal((await put('/api/agent/hive/swarm', { maxHelpers: 11 })).status, 400);
  assert.equal((await put('/api/agent/solo/swarm', { maxHelpers: 4 })).status, 404, 'an ordinary agent took swarm settings');
  assert.equal((await put('/api/agent/nobody/swarm', { maxHelpers: 4 })).status, 404);
  // Paused by the person, and back on.
  await put('/api/agent/hive/swarm', { active: false });
  assert.equal(swarm.settingsOf(store.readProfile('hive')).pausedBecause, 'person');
  await put('/api/agent/hive/swarm', { active: true });
  assert.equal(swarm.settingsOf(store.readProfile('hive')).active, true);
});

test('#3564 Stop now: the swarm is paused "stopped" even when the interrupt cannot be confirmed, and the answer says so', async () => {
  lead('hive2', swarm.birthProfile({ dailyTokenLimit: 1000 }));
  const r = await post('/api/agent/hive2/swarm/stop');
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.ok, true);
  assert.equal(b.stopped, false, 'no pane on this sandbox board, so the interrupt cannot have happened');
  assert.ok(b.because, 'an unconfirmed stop must say why');
  const s = swarm.settingsOf(store.readProfile('hive2'));
  assert.deepEqual([s.active, s.pausedBecause], [false, 'stopped']);
  assert.equal((await post('/api/agent/nobody/swarm/stop')).status, 404);
});

test('#3564 per project: On/Off only for a swarm that is a member; stored per project', async () => {
  lead('hive3', swarm.birthProfile({ dailyTokenLimit: 1000 }));
  lead('solo3', { role: 'pm' });
  const made = projects.create({ name: 'Swarm Route Room' });
  const id = made.id || (made.project && made.project.id);
  projects.mutate(id, (p) => ({ ...p, agents: ['hive3', 'solo3'] }));
  const r = await put(`/api/project/${encodeURIComponent(id)}/swarm/hive3`, { on: false });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(projects.swarmOffIn(id, 'hive3'), true);
  assert.equal((await put(`/api/project/${encodeURIComponent(id)}/swarm/solo3`, { on: false })).status, 404, 'an ordinary agent was switched off as a swarm');
  assert.equal((await put(`/api/project/${encodeURIComponent(id)}/swarm/stranger`, { on: false })).status, 404);
  assert.equal((await put(`/api/project/${encodeURIComponent(id)}/swarm/hive3`, { on: 'no' })).status, 400);
  await put(`/api/project/${encodeURIComponent(id)}/swarm/hive3`, { on: true });
  assert.equal(projects.swarmOffIn(id, 'hive3'), false);
});

test('#3564 per project: a message to a swarm switched off in that project is refused with the sentence, before anything is typed', async () => {
  lead('hive4', swarm.birthProfile({ dailyTokenLimit: 1000 }));
  const made = projects.create({ name: 'Swarm Thread Room' });
  const id = made.id || (made.project && made.project.id);
  projects.mutate(id, (p) => ({ ...p, agents: ['hive4'] }));
  projects.setSwarmOn(id, 'hive4', false);
  // The thread route builds members from the LIVE roster (projects.get(id, roster)), so hive4 is put on the board.
  const board = require('./test-support/fleet').install([require('./test-support/fleet').agent('hive4', { state: 'idle' })]);
  try {
  const r = await post(`/api/project/${encodeURIComponent(id)}/thread/hive4`, { text: 'please do this' });
  const b = await r.json();
  assert.equal(r.status, 409, JSON.stringify(b));
  assert.match(b.error || b.because || '', /switched off in this project/);
  // CONTROL: switched back on, it is no longer this refusal (whatever the sandbox board says next).
  projects.setSwarmOn(id, 'hive4', true);
  const r2 = await post(`/api/project/${encodeURIComponent(id)}/thread/hive4`, { text: 'please do this' });
  const b2 = await r2.json();
  assert.doesNotMatch(JSON.stringify(b2), /switched off in this project/);
  } finally { board.restore(); }
});

test('#3564 per project: a task line is not sent to a swarm switched off in that project; switched on, it is', async () => {
  const fleetMod = require('./test-support/fleet');
  const tasks = require('./engine/tasks');
  lead('hive5', swarm.birthProfile({ dailyTokenLimit: 1000 }));
  const board = fleetMod.install([fleetMod.agent('hive5', { state: 'idle' })]);
  try {
    const p = projects.create({ name: 'Swarm Task Room' });
    projects.addAgent(p.id, 'hive5', board.agents);
    const t = tasks.create(p.id, { sentence: 'Split this up', who: 'hive5' }, board.agents);
    const say = () => fetch(`${base}/api/project/${encodeURIComponent(p.id)}/task/${t.number}/message`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ text: 'how is it going' }),
    });
    projects.setSwarmOn(p.id, 'hive5', false);
    const off = await (await say()).json();
    assert.deepEqual((off.delivered || []).map((d) => d.agent), [], 'a switched-off swarm was told about its task');
    projects.setSwarmOn(p.id, 'hive5', true);
    const on = await (await say()).json();
    assert.deepEqual((on.delivered || []).map((d) => d.agent), ['hive5'], 'CONTROL: switched on, the assignee is told');
  } finally { board.restore(); }
});

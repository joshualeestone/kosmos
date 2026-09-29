'use strict';

/**
 * #4552: through the real board. April measured it live: an idle agent in a live project with an
 * unassigned task was never given it, because its commitments record read `unknown` (nothing shipped
 * wrote it); writing `{"commitments":[]}` by hand made the Assigner give the task 20 minutes later.
 * Here the agent's own `idle` report (POST /api/report, the Stop hook's path) writes that record, and
 * the Assigner's own step, fed the board's own reads, then gives the task. The control is the same
 * world before the report: unknown, and no task given.
 *
 *   node --test server.assigner-idle-record-4552.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-4552-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server, boardAuthState } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const selfreport = require('./engine/selfreport');
const commitments = require('./engine/commitments');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const status = require('./engine/status');
const assigner = require('./engine/assigner');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; boardAuthState.on = false; });
test.after(() => { server.closeAllConnections(); server.close(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

async function call(method, p, { headers = {}, body } = {}) {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = {}; try { json = JSON.parse(text); } catch { /* not json */ }
  return { code: res.status, json };
}

let seq = 0;
/* One idle agent of ours, a token to report as it, and a live project it belongs to with one
   unassigned task. */
function world() {
  const name = 'nudgee' + (++seq);
  const board = fleet.install([fleet.agent(name, { state: 'idle' })]);
  const card = board.agents.find((c) => (c.sessionName || '').startsWith(name));
  const who = card.sessionName;
  const tok = sendertoken.mint(who).token;
  const p = projects.create({ name: 'Assign Test ' + seq });
  projects.addAgent(p.id, who, board.agents);
  const t = tasks.create(p.id, { sentence: 'write the release notes', made: { via: 'screen' } });
  return { who, pid: p.id, n: t.number, h: { 'x-kosmos-agent-token': tok }, restore: () => { sendertoken.revoke(who); board.restore(); } };
}

/* The Assigner's own step twice, IDLE_MS apart, on the board's own reads (as its runner does). */
function assignerGives(w) {
  const cards = status.snapshot().agents;
  const states = () => new Map(cards.filter(assigner.idleCard).map((c) => [c.sessionName, commitments.read(c.sessionName).state]));
  const base2 = { roster: cards, setting: { on: true }, records: projects.readAll(), commitments: states() };
  const T0 = Date.now();
  const first = assigner.step({ prev: undefined, ...base2, now: T0 });
  const late = assigner.step({ prev: first.next, ...base2, now: T0 + assigner.IDLE_MS });
  return late.toAssign.filter((x) => x.session === w.who);
}

const report = (w, state, extra = {}) => call('POST', '/api/report', { headers: w.h, body: { state, ...extra } });

test.beforeEach(() => { try { fs.rmSync(selfreport.DIR, { recursive: true, force: true }); } catch { /* not there */ } });

test('April\'s shape: before any report the record is unknown and the Assigner gives nothing (control)', async () => {
  const w = world();
  try {
    const got = await call('GET', '/api/agent/' + encodeURIComponent(w.who) + '/commitments');
    assert.equal(got.json.state, 'unknown', JSON.stringify(got.json));
    assert.equal(got.json.neverReported, true);
    assert.deepEqual(assignerGives(w), [], 'the Assigner gave work to an agent it cannot vouch for');
  } finally { w.restore(); }
});

test('the agent\'s own idle report writes "holding nothing", and the Assigner then gives it the task', async () => {
  const w = world();
  try {
    const r = await report(w, 'idle', { auto: true });
    assert.equal(r.json.recorded, true, JSON.stringify(r.json));
    const got = await call('GET', '/api/agent/' + encodeURIComponent(w.who) + '/commitments');
    assert.equal(got.json.state, 'clear', JSON.stringify(got.json));
    const given = assignerGives(w);
    assert.equal(given.length, 1, 'the Assigner still gave nothing after the idle report');
    assert.equal(given[0].projectId, w.pid);
    assert.equal(given[0].n, w.n);
  } finally { w.restore(); }
});

test('a working report writes nothing (only idle stands for holding nothing)', async () => {
  const w = world();
  try {
    assert.equal((await report(w, 'working')).json.recorded, true);
    assert.equal(commitments.read(w.who).state, 'unknown');
  } finally { w.restore(); }
});

test('an idle report while the agent holds an open task part writes nothing; control: without the part it does', async () => {
  const w = world();
  try {
    const r = tasks.assignPart(w.pid, w.n, 1, w.who, { via: 'screen' });
    assert.ok(r && r.ok, 'fixture: assignPart refused');
    assert.equal((await report(w, 'idle')).json.recorded, true);
    assert.equal(commitments.read(w.who).state, 'unknown', 'wrote holding-nothing over an open task part');
    tasks.close(w.pid, w.n);
    assert.equal((await report(w, 'idle')).json.recorded, true);
    assert.equal(commitments.read(w.who).state, 'clear', 'control: with the task closed, the idle report writes it');
  } finally { w.restore(); }
});

test('a machine idle over a standing blocked is refused, and writes nothing; control: the agent\'s own idle does', async () => {
  const w = world();
  try {
    assert.equal((await report(w, 'blocked', { on: 'the deploy', owner: 'Angel' })).json.recorded, true);
    const auto = await report(w, 'idle', { auto: true });
    assert.equal(auto.json.recorded, false, 'fixture: a hook idle over blocked must be refused: ' + JSON.stringify(auto.json));
    assert.equal(commitments.read(w.who).state, 'unknown', 'a refused idle wrote holding-nothing');
    assert.equal((await report(w, 'idle')).json.recorded, true);
    assert.equal(commitments.read(w.who).state, 'clear');
  } finally { w.restore(); }
});

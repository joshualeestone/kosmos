'use strict';
/* #4552: the Assigner gave a real agent nothing, because it required a `clear` commitments record and
 * nothing shipped writes one (April, live: an idle agent in a live project with an unassigned task was
 * never given it; a hand-written empty list made it happen). Now the Assigner decides at check time
 * (commitmentsFree): an agent that stated nothing, or whose last stated list was empty, is free; one
 * whose list named work (fresh or stale), or whose record cannot be read, is not. Nothing is written.
 *
 * The runner's own composition (assigner.tick) is driven over REAL inputs: board cards from
 * test-support/fleet + status.snapshot(), the real commitments reader, and projects and tasks from
 * engine/projects + engine/tasks. Every "not given" arm has a control that the same world IS given.
 *
 *   node --test engine/assigner-free-4552.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'assigner-free-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');

const test = require('node:test');
const assert = require('node:assert/strict');

const fleet = require('../test-support/fleet');
const status = require('./status');
const projects = require('./projects');
const tasks = require('./tasks');
const commitments = require('./commitments');
const a = require('./assigner');
const { DELIVERY } = require('./chat');
require('../test-support/data-root-sandbox').assertSandboxedDataRoot(SANDBOX, [require('./store').ROOT]);

test.after(() => { try { fleet.restore(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

let seq = 0;
/* One idle agent of ours, a live project it belongs to, and one unassigned task in it. */
function world(name) {
  const board = fleet.install([fleet.agent(name, { state: 'idle' })]);
  const card = board.agents.find((c) => c.sessionName === name) || board.agents.find((c) => (c.sessionName || '').startsWith(name));
  const who = card.sessionName;
  const p = projects.create({ name: 'Free Test ' + (++seq) });
  projects.addAgent(p.id, who, board.agents);
  const t = tasks.create(p.id, { sentence: 'write the release notes', made: { via: 'screen' } });
  return { who, pid: p.id, n: t.number, restore: board.restore };
}

/* The runner's own tick twice, IDLE_MS apart, on the real reads; give records the call instead of writing. */
function ticks(w) {
  const given = [];
  const o = {
    readSetting: () => ({ on: true }),
    readRoster: () => status.snapshot().agents,
    readRecords: () => projects.readAll(),
    readCommitment: (s) => commitments.read(s),
    give: (projectId, n, partId, who) => { given.push({ projectId, n, who }); return { ok: true }; },
    ask: () => ({ state: DELIVERY.PLACED }), DELIVERY,
  };
  const T0 = Date.now();
  const first = a.tick({ prev: undefined, now: T0, ...o });
  a.tick({ prev: first.next, now: T0 + a.IDLE_MS, ...o });
  return given.filter((g) => g.who === w.who);
}

/* Age an agent's record on disk, the way time would. */
function age(who, ms) {
  const file = commitments.recordPath(who);
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  rec.reportedAt = new Date(Date.now() - ms).toISOString();
  fs.writeFileSync(file, JSON.stringify(rec));
}

test('commitmentsFree: stated clear, never reported, and an empty list gone stale are free; nothing else is', () => {
  const f = a.commitmentsFree;
  assert.equal(f({ state: 'clear', commitments: [] }), true);
  assert.equal(f({ state: 'unknown', neverReported: true, commitments: [] }), true);
  assert.equal(f({ state: 'unknown', stale: true, commitments: [] }), true);
  assert.equal(f({ state: 'holding', commitments: [{ id: 'a', what: 'x' }] }), false);
  assert.equal(f({ state: 'unknown', stale: true, commitments: [{ id: 'a', what: 'x' }] }), false);
  assert.equal(f({ state: 'unknown', neverReported: false, commitments: [] }), false, 'an unreadable record is not free');
  for (const v of [null, undefined, 'clear', {}]) assert.equal(f(v), false, JSON.stringify(v));
});

test('April\'s case: an idle agent that never reported a list is given the task after the idle period', () => {
  const w = world('never');
  try {
    assert.equal(commitments.read(w.who).neverReported, true, 'fixture: never reported');
    assert.deepEqual(ticks(w).map((g) => [g.projectId, g.n]), [[w.pid, w.n]]);
  } finally { w.restore(); }
});

test('an agent whose last list was empty, gone stale overnight, is given the task (no fresh report needed)', () => {
  const w = world('overnight');
  try {
    commitments.report(w.who, []);
    age(w.who, 10 * 60 * 60 * 1000);
    const rec = commitments.read(w.who);
    assert.equal(rec.state, 'unknown', 'fixture: stale');
    assert.equal(rec.stale, true, 'fixture: read as stale, not unreadable');
    assert.equal(ticks(w).length, 1);
  } finally { w.restore(); }
});

test('an agent that stated work is never given more, fresh or stale; control: once it states nothing, it is', () => {
  const w = world('stated');
  try {
    commitments.report(w.who, [{ id: 'a', what: 'check back after the deploy' }]);
    assert.equal(ticks(w).length, 0, 'gave work over a fresh stated list');
    age(w.who, 10 * 60 * 60 * 1000);
    assert.equal(commitments.read(w.who).stale, true, 'fixture: stale');
    assert.equal(ticks(w).length, 0, 'gave work over a stale stated list');
    commitments.report(w.who, []);
    assert.equal(ticks(w).length, 1, 'control: with nothing stated it is given');
  } finally { w.restore(); }
});

test('a record that exists but cannot be read is not free; control: removed, the agent is', () => {
  const w = world('garbled');
  try {
    const file = commitments.recordPath(w.who);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ not json');
    assert.equal(commitments.read(w.who).neverReported, false, 'fixture: unreadable is not never-reported');
    assert.equal(ticks(w).length, 0);
    fs.rmSync(file);
    assert.equal(ticks(w).length, 1);
  } finally { w.restore(); }
});

test('a record dated in the future is not free', () => {
  const w = world('future');
  try {
    commitments.report(w.who, []);
    age(w.who, -60 * 60 * 1000);
    assert.equal(commitments.read(w.who).state, 'unknown', 'fixture: future-dated reads unknown');
    assert.equal(ticks(w).length, 0);
    commitments.report(w.who, []);
    assert.equal(ticks(w).length, 1, 'control: the same agent with a present-dated empty list is given');
  } finally { w.restore(); }
});

test('nothing is written in the agent\'s name: a never-reported agent still reads never-reported after it is given work', () => {
  const w = world('nowrite');
  try {
    assert.equal(ticks(w).length, 1);
    assert.equal(commitments.read(w.who).neverReported, true, 'the Assigner wrote a record');
  } finally { w.restore(); }
});

test('step takes \'free\' like \'clear\' (tick\'s contract); control: \'unknown\' is still not given', () => {
  const w = world('stepfree');
  try {
    const cards = status.snapshot().agents;
    const run = (st) => {
      const base = { roster: cards, setting: { on: true }, records: projects.readAll(), commitments: new Map([[w.who, st]]) };
      const T0 = Date.now();
      const first = a.step({ prev: undefined, ...base, now: T0 });
      return a.step({ prev: first.next, ...base, now: T0 + a.IDLE_MS }).toAssign.filter((x) => x.session === w.who).length;
    };
    assert.equal(run('free'), 1);
    assert.equal(run('clear'), 1);
    assert.equal(run('unknown'), 0);
  } finally { w.restore(); }
});

test('the goal ask reaches a never-reported agent too (same "no work" judgement): with no task to give and a goal, it is asked', () => {
  const board = fleet.install([fleet.agent('goalask', { state: 'idle' })]);
  try {
    const card = board.agents.find((c) => (c.sessionName || '').startsWith('goalask'));
    const p = projects.create({ name: 'Goal Test ' + (++seq) });
    projects.addAgent(p.id, card.sessionName, board.agents);
    const asked = [];
    const o = {
      readSetting: () => ({ on: true }), readRoster: () => status.snapshot().agents, readRecords: () => projects.readAll(),
      readCommitment: (s) => commitments.read(s), readGoal: (proj) => (proj.id === p.id ? 'ship the beta' : null),
      give: () => ({ ok: true }), ask: (session) => { asked.push(session); return { state: DELIVERY.PLACED }; }, DELIVERY,
    };
    assert.equal(commitments.read(card.sessionName).neverReported, true, 'fixture: never reported');
    const T0 = Date.now();
    const first = a.tick({ prev: undefined, now: T0, ...o });
    a.tick({ prev: first.next, now: T0 + a.IDLE_MS, ...o });
    assert.deepEqual(asked, [card.sessionName]);
    // Control: an agent that stated work is not asked.
    commitments.report(card.sessionName, [{ id: 'x', what: 'finishing the export' }]);
    const asked2 = [];
    const o2 = { ...o, ask: (session) => { asked2.push(session); return { state: DELIVERY.PLACED }; } };
    const f2 = a.tick({ prev: undefined, now: T0, ...o2 });
    a.tick({ prev: f2.next, now: T0 + a.IDLE_MS, ...o2 });
    assert.deepEqual(asked2, [], 'an agent holding stated work was asked to draft tasks');
  } finally { board.restore(); }
});

test('the Settings hint describes the rule as it now is (the one place the person reads when the Assigner acts)', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  assert.match(page, /has had nothing to do for 20 minutes and has not told Kosmos it is still holding work/);
  assert.doesNotMatch(page, /has recently said it is holding no work/, 'the hint describes the old clear-only rule');
});

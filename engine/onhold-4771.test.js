'use strict';
/* #4771 (a real user's lead agent, relayed by Josh 2026-09-30): the Prompter and the Assigner pushed agents onto work the
   person had put on hold. A task can now be ON HOLD and a project PAUSED; neither automation touches held work, and it
   reads as "held" on the Tasks view. Every "not touched" below has a control: the same task, not held, is touched. */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'onhold-4771-'));
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
const taskchat = require('./taskchat');
const commitments = require('./commitments');
const a = require('./assigner');
const nudge = require('./agentnudge');
const { DELIVERY } = require('./chat');
require('../test-support/data-root-sandbox').assertSandboxedDataRoot(SANDBOX, [require('./store').ROOT]);

test.after(() => { try { fleet.restore(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

let seq = 0;
/* One idle agent of ours in a live project; `owned` gives the task to it, else nobody has it. */
function world(name, owned) {
  const board = fleet.install([fleet.agent(name, { state: 'idle' })]);
  const card = board.agents.find((c) => c.sessionName === name) || board.agents.find((c) => (c.sessionName || '').startsWith(name));
  const who = card.sessionName;
  const p = projects.create({ name: 'Hold Test ' + (++seq) });
  projects.addAgent(p.id, who, board.agents);
  const t = tasks.create(p.id, { sentence: 'write the release notes', who: owned ? who : undefined, made: { via: 'screen' } }, board.agents);
  return { who, pid: p.id, n: t.number, restore: board.restore };
}

/* The Assigner's own tick twice, IDLE_MS apart, on the real reads; records what it would give. */
function given(w) {
  const out = [];
  const o = {
    readSetting: () => ({ on: true }),
    readRoster: () => status.snapshot().agents,
    readRecords: () => projects.readAll(),
    readCommitment: (s) => commitments.read(s),
    give: (projectId, n, partId, who) => { out.push({ projectId, n, who }); return { ok: true }; },
    ask: () => ({ state: DELIVERY.PLACED }), DELIVERY,
  };
  const T0 = Date.now();
  const first = a.tick({ prev: undefined, now: T0, ...o });
  a.tick({ prev: first.next, now: T0 + a.IDLE_MS, ...o });
  return out.filter((g) => g.who === w.who && g.projectId === w.pid);
}

test('#4771 Assigner: an unowned task on hold is never handed out (control: the same task off hold is)', () => {
  const w = world('holdgive' + seq, false);
  try {
    tasks.setOnHold(w.pid, w.n, true);
    assert.deepEqual(given(w), [], 'the Assigner handed out a task on hold');
    tasks.setOnHold(w.pid, w.n, false);
    assert.equal(given(w).length, 1, 'control: off hold, the same task was not handed out, so the zero above proves nothing');
  } finally { w.restore(); }
});

test('#4771 Assigner: nothing in a paused project is handed out, and its goal is not asked about (control: resumed)', () => {
  const w = world('pausegive' + seq, false);
  try {
    projects.setPaused(w.pid, true);
    assert.deepEqual(given(w), [], 'the Assigner handed out a paused project\'s task');
    const rec = projects.readAll().find((p) => p.id === w.pid);
    assert.equal(a.goalProject(w.who, [Object.assign({}, rec, { tasks: [] })], new Map([[w.pid, 'ship it']]), new Map(), Date.now()), null,
      'a paused project\'s goal was put to an agent');
    projects.setPaused(w.pid, false);
    assert.equal(given(w).length, 1, 'control: resumed, the same task was not handed out');
    const back = projects.readAll().find((p) => p.id === w.pid);
    assert.ok(a.goalProject(w.who, [Object.assign({}, back, { tasks: [] })], new Map([[w.pid, 'ship it']]), new Map(), Date.now()),
      'control: a live project with a goal and no tasks was not asked about either');
  } finally { w.restore(); }
});

test('#4771 Prompter: an agent holding only held work is not nudged; held work does not keep it busy for the Assigner', () => {
  const w = world('holdnudge' + seq, true);
  try {
    const recs = () => projects.readAll();
    assert.equal(nudge.openParts(w.who, recs()).length, 1, 'control: an owned open task was not seen as open work');
    assert.equal(a.hasOpenWork(w.who, recs()), true, 'control: an owned open task did not keep the agent busy');
    tasks.setOnHold(w.pid, w.n, true);
    assert.deepEqual(nudge.openParts(w.who, recs()), [], 'a task on hold is still open work to be nudged about');
    assert.equal(a.hasOpenWork(w.who, recs()), false, 'a task on hold still keeps the agent busy for the Assigner');
    assert.deepEqual(nudge.realStalls([{ session: w.who, from: 'working', to: 'idle' }], recs()), [], 'a check-in was raised about held work');
    tasks.setOnHold(w.pid, w.n, false);
    projects.setPaused(w.pid, true);
    assert.deepEqual(nudge.openParts(w.who, recs()), [], 'a paused project\'s task is still open work to be nudged about');
    assert.equal(a.hasOpenWork(w.who, recs()), false, 'a paused project\'s task still keeps the agent busy');
    // A broken agent is still asked about, whatever it holds (engine/heartbeat.js has no other path to the person).
    assert.equal(nudge.realStalls([{ session: w.who, from: 'working', to: 'auth_failed' }], recs()).length, 1);
  } finally { w.restore(); }
});

test('#4771 the states are stored, shown and recorded: task on hold, project paused, the Tasks view reads both as held', () => {
  const w = world('holdstore' + seq, true);
  try {
    assert.throws(() => tasks.setOnHold(w.pid, w.n, 'yes'), /onHold must be true or false/);
    assert.throws(() => tasks.setOnHold(w.pid, 999, true), /no task by that number/);
    const held = tasks.setOnHold(w.pid, w.n, true);
    assert.equal(held.onHold, true);
    assert.equal(tasks.isOnHold(tasks.byNumber(projects.readAll().find((p) => p.id === w.pid), w.n)), true, 'the hold was not stored');
    const row = () => tasks.allTasks().find((t) => t.projectId === w.pid && t.number === w.n);
    assert.equal(tasks.taskState(row()), 'held');
    tasks.setOnHold(w.pid, w.n, true);   // the same again: no second event
    tasks.setOnHold(w.pid, w.n, false);
    assert.equal('onHold' in tasks.byNumber(projects.readAll().find((p) => p.id === w.pid), w.n), false, 'off hold left a stored field behind');
    assert.notEqual(tasks.taskState(row()), 'held', 'control: off hold, the task still reads held');
    const kinds = taskchat.read(w.pid, w.n).map((e) => e.kind).filter((k) => /^hold-/.test(k));
    assert.deepEqual(kinds, ['hold-set', 'hold-cleared'], 'the activity did not record exactly one hold and one release');
    const vias = () => taskchat.read(w.pid, w.n).filter((e) => /^hold-/.test(e.kind)).map((e) => e.via);
    assert.deepEqual(vias(), ['agent', 'agent'], 'a hold not made on the screen did not record it as an agent\'s');
    tasks.setOnHold(w.pid, w.n, true, { viaScreen: true });
    tasks.setOnHold(w.pid, w.n, false, { viaScreen: true });
    assert.deepEqual(vias().slice(2), ['screen', 'screen'], 'the person\'s hold on the screen was not recorded as theirs');

    assert.throws(() => projects.setPaused(w.pid, 'yes'), /paused must be true or false/);
    projects.setPaused(w.pid, true);
    assert.equal(row().projectPaused, true);
    assert.equal(tasks.taskState(row()), 'held', 'a paused project\'s task does not read held on the Tasks view');
    projects.setPaused(w.pid, false);
    assert.equal('paused' in projects.readAll().find((p) => p.id === w.pid), false, 'resuming left a stored field behind');
  } finally { w.restore(); }
});

'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/* kosmos#9168: the Assigner does not hand out a task nobody is on until it is one tick old, so a hold put on it just
 * after it is made (task add, then task hold) wins. On real inputs: board cards from test-support/fleet, commitments
 * from engine/commitments, projects and tasks from engine/projects + engine/tasks. Each clock is set from the task's own
 * createdAt, so the age the Assigner reads is exact.
 *
 *   node --test engine/assigner-holdrace-9168.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'assigner-9168-'));
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

test.after(() => { try { fleet.restore(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const ON = { on: true };
let seq = 0;

/* One idle agent with clear commitments, on a fresh project. */
function world() {
  const name = 'hr' + (++seq);
  const board = fleet.install([fleet.agent(name, { state: 'idle' })]);
  const card = board.agents.find((c) => (c.sessionName || '').startsWith(name));
  const session = card.sessionName;
  assert.ok(commitments.report(session, []).ok !== false);
  const p = projects.create({ name: 'Hold race ' + seq });
  projects.addAgent(p.id, session, board.agents);
  const cards = status.snapshot().agents;
  const base = () => ({ roster: cards, setting: ON, records: projects.readAll(),
    commitments: new Map(cards.filter(a.idleCard).map((c) => [c.sessionName, commitments.read(c.sessionName).state])) });
  return { pid: p.id, session, base };
}
const addTask = (pid, sentence, extra = {}) => tasks.create(pid, { sentence, made: { via: 'screen' }, ...extra });
const bornAt = (pid, n) => Date.parse(tasks.byNumber(projects.readAll().find((p) => p.id === pid), n).createdAt);

/* Seen idle well before `at`, then stepped at `at`: the agent has been idle long enough, so only the task's age decides. */
function stepAt(w, at) {
  const seen = a.step({ prev: undefined, ...w.base(), now: at - a.IDLE_MS - 1000 });
  return a.step({ prev: seen.next, ...w.base(), now: at });
}
const given = (out) => out.toAssign.map((x) => x.n);

test('#9168: a task one tick old is handed out (CONTROL: the fixture can give)', () => {
  const w = world();
  const t = addTask(w.pid, 'Free task');
  assert.deepEqual(given(stepAt(w, bornAt(w.pid, t.number) + a.NEW_TASK_GRACE_MS)), [t.number]);
});

test('#9168: a task younger than one tick is not handed out yet', () => {
  const w = world();
  const t = addTask(w.pid, 'Just made');
  const born = bornAt(w.pid, t.number);
  assert.deepEqual(given(stepAt(w, born + 5000)), []);
  assert.deepEqual(given(stepAt(w, born + a.NEW_TASK_GRACE_MS - 1)), [], 'one millisecond short of the grace');
});

test('#9168: add, then hold seconds later: the hold wins, and the task stays out after the grace', () => {
  const w = world();
  const t = addTask(w.pid, 'To be held');
  const born = bornAt(w.pid, t.number);
  assert.deepEqual(given(stepAt(w, born + 5000)), [], 'a tick between the add and the hold does not give it');
  tasks.setOnHold(w.pid, t.number, true, { viaScreen: true, because: 'wait for the design' });
  assert.deepEqual(given(stepAt(w, born + a.NEW_TASK_GRACE_MS + 5000)), [], 'held: never given');
});

test('#9168: a createdAt ahead of the clock does not hold a task back (a bad clock cannot park it for good)', () => {
  const w = world();
  const t = addTask(w.pid, 'Stamped ahead');
  assert.deepEqual(given(stepAt(w, bornAt(w.pid, t.number) - 10 * 60 * 1000)), [t.number]);
});

test('#9168: a young subtask still holds its old parent back (the grace is in pick, not in the shared filters)', () => {
  const w = world();
  const parent = addTask(w.pid, 'Umbrella');
  // The parent was made ten minutes ago; its subtask was made just now.
  const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  projects.mutate(w.pid, (p) => ({ ...p, tasks: p.tasks.map((t) => (t.number === parent.number ? { ...t, createdAt: old } : t)) }));
  const child = addTask(w.pid, 'First piece', { parent: parent.number });
  const childBorn = bornAt(w.pid, child.number);
  assert.ok(childBorn - bornAt(w.pid, parent.number) >= a.NEW_TASK_GRACE_MS, 'fixture: the parent is past its grace');
  // Neither goes: the child is too young, and the parent waits on its open subtask, as it would before #9168.
  assert.deepEqual(given(stepAt(w, childBorn + 5000)), []);
  // A tick after the child was made, the child goes first, not the parent.
  assert.deepEqual(given(stepAt(w, childBorn + a.NEW_TASK_GRACE_MS)), [child.number]);
});

test('#9168: pick called with no clock keeps its old behaviour (no grace)', () => {
  const w = world();
  const t = addTask(w.pid, 'Direct pick');
  const c = a.pick(w.session, projects.readAll(), new Set());
  assert.equal(c && c.n, t.number);
});

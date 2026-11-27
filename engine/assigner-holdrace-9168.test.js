'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/* kosmos#9168: the Assigner does not hand out a task nobody is on until it is 60 s old, so a hold put on it within a
 * minute of the add (task add, then task hold) wins. On real inputs: board cards from test-support/fleet, commitments
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
  const other = projects.create({ name: 'Hold race other ' + seq });   // a second project of the agent's, empty
  projects.addAgent(other.id, session, board.agents);
  const cards = status.snapshot().agents;
  const base = () => ({ roster: cards, setting: ON, records: projects.readAll(),
    commitments: new Map(cards.filter(a.idleCard).map((c) => [c.sessionName, commitments.read(c.sessionName).state])) });
  return { pid: p.id, otherId: other.id, session, base };
}
const addTask = (pid, sentence, extra = {}) => tasks.create(pid, { sentence, made: { via: 'screen' }, ...extra });
const bornAt = (pid, n) => Date.parse(tasks.byNumber(projects.readAll().find((p) => p.id === pid), n).createdAt);

/* Seen idle well before `at`, then stepped at `at`: the agent has been idle long enough, so only the task's age decides. */
function stepAt(w, at, extra = {}) {
  const seen = a.step({ prev: undefined, ...w.base(), ...extra, now: at - a.IDLE_MS - 1000 });
  return a.step({ prev: seen.next, ...w.base(), ...extra, now: at });
}
const given = (out) => out.toAssign.map((x) => x.n);

test('#9168: a task 60 s old is handed out (CONTROL: the fixture can give)', () => {
  const w = world();
  const t = addTask(w.pid, 'Free task');
  assert.deepEqual(given(stepAt(w, bornAt(w.pid, t.number) + a.NEW_TASK_GRACE_MS)), [t.number]);
});

test('#9168: a task younger than 60 s is not handed out yet', () => {
  const w = world();
  const t = addTask(w.pid, 'Just made');
  const born = bornAt(w.pid, t.number);
  assert.deepEqual(given(stepAt(w, born + 5000)), []);
  assert.deepEqual(given(stepAt(w, born + a.NEW_TASK_GRACE_MS - 1)), [], 'one millisecond short of the grace');
});

test('#9168: add two, hold one seconds later: the held one is never given, its unheld twin is once 60 s old', () => {
  const w = world();
  const held = addTask(w.pid, 'To be held');
  const twin = addTask(w.pid, 'Its twin, never held');
  const born = Math.max(bornAt(w.pid, held.number), bornAt(w.pid, twin.number));
  assert.deepEqual(given(stepAt(w, born + 5000)), [], 'a tick between the add and the hold gives neither');
  tasks.setOnHold(w.pid, held.number, true, { viaScreen: true, because: 'wait for the design' });
  assert.deepEqual(given(stepAt(w, born + a.NEW_TASK_GRACE_MS + 5000)), [twin.number], 'only the unheld twin goes');
});

test('#9168 review 1: an agent whose new task is waiting out its 60 s is not sent to draft tasks for another project', () => {
  const w = world();
  const goals = new Map([[w.otherId, 'A real goal for the other project.']]);
  const t = addTask(w.pid, 'Just made');
  const born = bornAt(w.pid, t.number);
  const during = stepAt(w, born + 5000, { goals });
  assert.deepEqual(given(during), []);
  assert.deepEqual(during.toAsk, [], 'no goal ask while its task waits');
  const after = stepAt(w, born + a.NEW_TASK_GRACE_MS, { goals });
  assert.deepEqual(given(after), [t.number], 'and then it is given the task');
  assert.deepEqual(after.toAsk, []);
});

test('#9168 review 1 CONTROL: with nothing waiting for it, the same agent IS asked about the other project', () => {
  const w = world();
  const goals = new Map([[w.otherId, 'A real goal for the other project.']]);
  const t = addTask(w.pid, 'Held at once');
  tasks.setOnHold(w.pid, t.number, true, { viaScreen: true, because: 'not yet' });
  const out = stepAt(w, bornAt(w.pid, t.number) + 5000, { goals });
  assert.deepEqual(given(out), []);
  assert.deepEqual(out.toAsk.map((x) => x.projectId), [w.otherId], 'the fixture can ask');
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
  // 60 s after the child was made, the child goes first, not the parent.
  assert.deepEqual(given(stepAt(w, childBorn + a.NEW_TASK_GRACE_MS)), [child.number]);
});

test('#9168: pick called with no clock keeps its old behaviour (no grace)', () => {
  const w = world();
  const t = addTask(w.pid, 'Direct pick');
  const c = a.pick(w.session, projects.readAll(), new Set());
  assert.equal(c && c.n, t.number);
});

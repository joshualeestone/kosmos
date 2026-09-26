'use strict';
/* #3559: where a task's work is, derived from evidence (taskState), and when it
 * last moved (lastActivityOf). Only states the engine can prove today exist.
 *
 *   node --test engine/tasks.state-3559.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const nodePath = require('node:path');

process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-tstate-'));
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-tstate-data-'));
const projects = require('./projects');
const tasks = require('./tasks');
const commitments = require('./commitments');
const taskchat = require('./taskchat');

let seq = 0;
const freshProject = (name) => projects.create({ name: `${name} ${++seq}` });
const joined = (p) => projects.joinTaskClaims(p.tasks, projects.readAll(), p.agents, [], { name: p.name, id: p.id });

test('taskState: nobody, assigned (not named), working (named), closed, from the evidence', () => {
  const p = freshProject('States');
  projects.addAgent(p.id, 'stateagent', null);
  tasks.create(p.id, { sentence: 'Nobody on it' });
  tasks.create(p.id, { sentence: 'Given, not named', who: 'stateagent' });
  tasks.create(p.id, { sentence: 'Given and named', who: 'stateagent' });
  tasks.create(p.id, { sentence: 'Finished', who: 'stateagent' });
  tasks.close(p.id, 4);
  commitments.report('stateagent', [{ what: 'working on task 3 now' }]);
  const rows = joined(projects.readAll().find((x) => x.id === p.id));
  assert.deepEqual(rows.map((t) => tasks.taskState(t)), ['nobody', 'assigned', 'working', 'closed']);
});

test('taskState: a claim that cannot be read stays assigned, never working, and keeps its reason', () => {
  const t = { number: 5, who: 'x', claim: { claimed: null, because: 'we could not read what it reports holding' } };
  assert.equal(tasks.taskState(t), 'assigned');
  assert.equal(tasks.taskState({ number: 5, who: 'x', claim: { claimed: false, because: null } }), 'assigned');
  assert.equal(tasks.taskState({ number: 5, who: 'x' }), 'assigned', 'a task with no claim at all is not in progress');
  assert.equal(tasks.taskState({ number: 5, who: 'x', claim: { claimed: true } }), 'working');
});

test('taskState: parts decide too (a task whose every part is done is closed; a part with an agent is assigned)', () => {
  const allDone = { number: 1, parts: [{ id: 1, who: 'a', closedAt: '2026-09-01T00:00:00Z' }] };
  assert.equal(tasks.taskState(allDone), 'closed');
  const onePartGiven = { number: 2, parts: [{ id: 1, who: null }, { id: 2, who: 'b' }] };
  assert.equal(tasks.taskState(onePartGiven), 'assigned');
  assert.equal(tasks.taskState(null), 'nobody');
});

test('taskState never answers a group the engine cannot prove (done-check-it); decision only with waitingOnPerson', () => {
  const seen = new Set();
  for (const claimed of [true, false, null, undefined]) {
    for (const who of ['a', null]) {
      for (const closedAt of [null, '2026-09-01T00:00:00Z']) {
        seen.add(tasks.taskState({ number: 1, who, closedAt, claim: claimed === undefined ? undefined : { claimed } }));
      }
    }
  }
  assert.deepEqual([...seen].sort(), ['assigned', 'closed', 'nobody', 'working']);
});

test('lastActivityOf: the newest transcript event, else created; never "now" for an unknown', () => {
  const p = freshProject('Activity');
  const t = tasks.create(p.id, { sentence: 'Something to do' });
  /* create() records a "created" event a moment after stamping createdAt, so the newest of the
     two is the answer (asserting createdAt alone passed only when both landed in one ms). */
  const newestOf = () => [t.createdAt].concat(taskchat.read(p.id, t.number).map((e) => e.at))
    .sort((a, b) => Date.parse(a) - Date.parse(b)).pop();
  assert.equal(tasks.lastActivityOf(p.id, t), newestOf(), 'the last activity is the newest of made and its events');
  assert.equal(tasks.lastActivityOf(p.id, { number: 998, createdAt: '2026-09-01T00:00:00Z' }), '2026-09-01T00:00:00Z', 'with no events at all, it is when the task was made');
  taskchat.record(p.id, t.number, { kind: 'said', text: 'a later word' });
  const events = taskchat.read(p.id, t.number);
  const newest = events.map((e) => e.at).sort().pop();
  assert.equal(tasks.lastActivityOf(p.id, t), newest);
  assert.ok(Date.parse(newest) >= Date.parse(t.createdAt));
  assert.equal(tasks.lastActivityOf(p.id, { number: 999 }), null, 'a task with no dates has no answer, not now');
  assert.equal(tasks.lastActivityOf(p.id, null), null);
});

test('lastActivityOf: a CLOSED task is last active when it closed; its transcript is not read', () => {
  const closed = { number: 5, createdAt: '2026-09-01T00:00:00Z', closedAt: '2026-09-02T00:00:00Z' };
  const p = freshProject('Closed activity');
  // An event stamped long after the close: for an open task it would win; for a closed one it must not.
  const orig = taskchat.read;
  let reads = 0;
  taskchat.read = () => { reads += 1; return [{ at: '2026-09-20T00:00:00Z', kind: 'said' }]; };
  try {
    assert.equal(tasks.lastActivityOf(p.id, closed), '2026-09-02T00:00:00Z');
    assert.equal(reads, 0, 'a closed task\'s transcript was read');
    assert.equal(tasks.lastActivityOf(p.id, { number: 6, createdAt: '2026-09-01T00:00:00Z', closedAt: null }), '2026-09-20T00:00:00Z', 'control: an open task does read it');
    assert.equal(reads, 1);
  } finally { taskchat.read = orig; }
});

test('lastActivityOf: a task closed because every PART closed is last active when its last part closed', () => {
  const t = { number: 9, createdAt: '2026-09-01T00:00:00Z', closedAt: null,
    parts: [{ id: 1, who: 'a', closedAt: '2026-09-10T00:00:00Z' }, { id: 2, who: 'b', closedAt: '2026-09-20T00:00:00Z' }] };
  assert.equal(tasks.taskState(t), 'closed');
  assert.equal(tasks.lastActivityOf('nowhere', t), '2026-09-20T00:00:00Z', 'it read as untouched since it was made');
});

test('allTasks(snapshot) reads the snapshot it is handed, not the store again', () => {
  const fake = [{ id: 'zz', name: 'Snapshot only', tasks: [{ number: 1, sentence: 'from the snapshot', createdAt: '2026-09-01T00:00:00Z', closedAt: null }] }];
  const rows = tasks.allTasks(fake);
  assert.deepEqual(rows.map((r) => [r.projectId, r.sentence]), [['zz', 'from the snapshot']]);
  assert.equal(rows[0].projectArchived, false);
  assert.equal(tasks.allTasks([{ id: 'ar', name: 'Set aside', archived: true, tasks: [{ number: 1, sentence: 'x' }] }])[0].projectArchived, true);
});

/* #3949 (Josh, 2026-09-26): Needs Your Decision. An open task whose holding agent needs the person, and
   for a question, a question about THIS task's project (the project page's rule, #763/#3726). */
test('#3949 waitingOnPerson: the holding agent needs the person, about this task\'s project', () => {
  const task = { projectId: 'p1', number: 3, who: 'rex', closedAt: null };
  const card = (over) => Object.assign({ sessionName: 'rex', isNamedOurs: true, state: 'needs_you', stateProject: 'p1' }, over);
  assert.equal(tasks.waitingOnPerson(task, [card()]), true, 'a question about this project');
  assert.equal(tasks.waitingOnPerson(task, [card({ stateProject: 'p2' })]), false, 'a question about another project');
  assert.equal(tasks.waitingOnPerson(task, [card({ stateProject: null })]), false, 'a question about no project');
  assert.equal(tasks.waitingOnPerson(task, [card({ state: 'needs_trust', stateProject: null })]), true, 'a trust wait is about the agent itself');
  assert.equal(tasks.waitingOnPerson(task, [card({ state: 'working' })]), false, 'working is not waiting on the person');
  assert.equal(tasks.waitingOnPerson(task, [card({ isNamedOurs: false })]), false, 'an untied pane is somebody else\'s state');
  assert.equal(tasks.waitingOnPerson(task, [card({ sessionName: 'other' })]), false, 'another agent asking is not this task\'s agent');
  assert.equal(tasks.waitingOnPerson(Object.assign({}, task, { closedAt: '2026-09-01T00:00:00Z' }), [card()]), false, 'a closed task waits on nobody');
  assert.equal(tasks.waitingOnPerson(Object.assign({}, task, { who: null }), [card()]), false, 'an unassigned task has no agent to wait');
  assert.equal(tasks.waitingOnPerson(task, null), false);
});

test('#3949 taskState: decision comes from waitingOnPerson, ahead of working and assigned, and closed still wins', () => {
  assert.equal(tasks.taskState({ number: 1, who: 'a', claim: { claimed: true }, waitingOnPerson: true }), 'decision');
  assert.equal(tasks.taskState({ number: 1, who: 'a', claim: { claimed: false }, waitingOnPerson: true }), 'decision');
  assert.equal(tasks.taskState({ number: 1, who: 'a', claim: { claimed: true }, waitingOnPerson: false }), 'working', 'control: not waiting stays working');
  assert.equal(tasks.taskState({ number: 1, who: 'a', closedAt: '2026-09-01T00:00:00Z', waitingOnPerson: true }), 'closed');
  assert.equal(tasks.taskState({ number: 1, who: null, waitingOnPerson: true }), 'nobody', 'nobody to wait');
  assert.equal(tasks.taskState({ number: 1, who: 'a', claim: { claimed: true }, waitingOnPerson: 'yes' }), 'working', 'only a real true counts');
});

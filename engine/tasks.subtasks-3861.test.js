'use strict';

/**
 * #3861 (Josh, 2026-09-25 20:20: "Let's add something to tasks so they can have a parent"):
 * a task can sit under another task on the same project. The engine stores a parent task
 * number (or null), refuses a parent that is not a task here, the task itself, or a loop,
 * never cascades a close either way, and derives the parent's "2 of 5 done".
 *
 * ⚠️ SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/tasks.subtasks-3861.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sub-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sub-proj-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');
const tasks = require('../engine/tasks');
const taskchat = require('../engine/taskchat');

function freshProject() {
  return projects.create({ name: 'Sub ' + Math.random().toString(36).slice(2) }).id;
}
const rowOf = (id, n) => tasks.allTasks().find((t) => t.projectId === id && t.number === n);
const stored = (id, n) => tasks.byNumber(projects.get(id), n);

test('a new task is born with parent null, and a subtask with its parent number', () => {
  const id = freshProject();
  const top = tasks.create(id, { sentence: 'The whole launch' });
  assert.equal(top.parent, null, 'the field must exist on every new task, null when top level');
  const kid = tasks.create(id, { sentence: 'Write the copy', parent: top.number });
  assert.equal(kid.parent, top.number);
  assert.equal(stored(id, kid.number).parent, top.number, 'the parent was not stored');
  // A digit string (what the Mac CLI sends) is the same number.
  const kid2 = tasks.create(id, { sentence: 'Pick the date', parent: String(top.number) });
  assert.equal(kid2.parent, top.number);
});

test('create refuses a parent that is not a task on this project, and stores nothing', () => {
  const id = freshProject();
  const other = freshProject();
  tasks.create(other, { sentence: 'Elsewhere' }); // task 1 on ANOTHER project
  const before = (projects.get(id).tasks || []).length;
  assert.throws(() => tasks.create(id, { sentence: 'x', parent: 1 }), /no task 1 on this project/);
  for (const bad of [0, -1, 1.5, 'abc', '3.0', {}, [], true]) {
    assert.throws(() => tasks.create(id, { sentence: 'x', parent: bad }), /task number on this project/, 'accepted ' + JSON.stringify(bad));
  }
  assert.equal((projects.get(id).tasks || []).length, before, 'a refused create wrote a task');
  // Control: the same call with a real parent on THIS project lands.
  const top = tasks.create(id, { sentence: 'Real' });
  assert.equal(tasks.create(id, { sentence: 'x', parent: top.number }).parent, top.number);
});

test('setParent refuses itself and every loop, at any depth, and changes nothing', () => {
  const id = freshProject();
  const a = tasks.create(id, { sentence: 'A' });
  const b = tasks.create(id, { sentence: 'B', parent: a.number });
  const c = tasks.create(id, { sentence: 'C', parent: b.number });
  assert.throws(() => tasks.setParent(id, a.number, a.number), /cannot be part of itself/);
  assert.throws(() => tasks.setParent(id, a.number, b.number), /already under this task/, 'direct loop');
  assert.throws(() => tasks.setParent(id, a.number, c.number), /already under this task/, 'two-deep loop');
  assert.equal(stored(id, a.number).parent, null, 'a refused link was stored');
  // Controls: a legal re-link lands, and so does clearing.
  const d = tasks.create(id, { sentence: 'D' });
  assert.equal(tasks.setParent(id, c.number, d.number).parent, d.number);
  assert.equal(tasks.setParent(id, c.number, null).parent, null);
  assert.equal(tasks.setParent(id, c.number, '').parent, null);
});

test('setParent on a missing task is the not-found sentence; on a missing parent a different one', () => {
  const id = freshProject();
  const a = tasks.create(id, { sentence: 'A' });
  assert.throws(() => tasks.setParent(id, 99, a.number), /no task by that number/);
  assert.throws(() => tasks.setParent(id, a.number, 99), /no task 99 on this project/);
});

test('setParent records set and cleared in the transcript, and a no-op records nothing', () => {
  const id = freshProject();
  const a = tasks.create(id, { sentence: 'A' });
  const b = tasks.create(id, { sentence: 'B' });
  tasks.setParent(id, b.number, a.number);
  tasks.setParent(id, b.number, a.number); // same value again
  tasks.setParent(id, b.number, null);
  const kinds = taskchat.read(id, b.number).map((e) => e.kind);
  assert.deepEqual(kinds.filter((k) => k.startsWith('parent')), ['parent-set', 'parent-cleared']);
  const set = taskchat.read(id, b.number).find((e) => e.kind === 'parent-set');
  assert.equal(set.parent, a.number);
});

test('closing a parent never closes its children, and closing every child never closes the parent', () => {
  const id = freshProject();
  const top = tasks.create(id, { sentence: 'Top' });
  const k1 = tasks.create(id, { sentence: 'One', parent: top.number });
  const k2 = tasks.create(id, { sentence: 'Two', parent: top.number });
  tasks.close(id, top.number);
  assert.equal(rowOf(id, k1.number).isClosed, false, 'closing the parent closed a child');
  assert.equal(rowOf(id, k2.number).isClosed, false);
  tasks.reopen(id, top.number);
  tasks.close(id, k1.number);
  tasks.close(id, k2.number);
  assert.equal(rowOf(id, top.number).isClosed, false, 'the last child closing closed the parent; the person decides');
  assert.deepEqual(rowOf(id, top.number).subtasks, { done: 2, total: 2 });
});

test('allTasks rows carry parent, parentSentence and a direct-children count', () => {
  const id = freshProject();
  const top = tasks.create(id, { sentence: 'Top' });
  const k1 = tasks.create(id, { sentence: 'One', parent: top.number });
  tasks.create(id, { sentence: 'Two', parent: top.number });
  const g = tasks.create(id, { sentence: 'Grandchild', parent: k1.number });
  tasks.close(id, g.number);
  const topRow = rowOf(id, top.number);
  assert.deepEqual(topRow.subtasks, { done: 0, total: 2 }, 'a grandchild must not count on the grandparent');
  assert.equal(topRow.parent, null);
  assert.equal(topRow.parentSentence, null);
  const k1Row = rowOf(id, k1.number);
  assert.equal(k1Row.parent, top.number);
  assert.equal(k1Row.parentSentence, 'Top');
  assert.deepEqual(k1Row.subtasks, { done: 1, total: 1 });
  // A task with no subtasks says 0 of 0, never undefined.
  assert.deepEqual(rowOf(id, g.number).subtasks, { done: 0, total: 0 });
});

test('a stored parent that is not a task here reads as top level, never as nested under nothing', () => {
  const id = freshProject();
  const a = tasks.create(id, { sentence: 'A' });
  // A hand-edited store: a dangling number, and a task naming itself.
  projects.mutate(id, (p) => ({ ...p, tasks: p.tasks.map((t) => ({ ...t, parent: t.number === a.number ? 42 : t.parent })) }));
  assert.equal(rowOf(id, a.number).parent, null);
  projects.mutate(id, (p) => ({ ...p, tasks: p.tasks.map((t) => ({ ...t, parent: t.number === a.number ? a.number : t.parent })) }));
  assert.equal(rowOf(id, a.number).parent, null);
  // A loop already in the store does not hang the checker: linking anything into it answers.
  const b = tasks.create(id, { sentence: 'B' });
  const c = tasks.create(id, { sentence: 'C' });
  projects.mutate(id, (p) => ({ ...p, tasks: p.tasks.map((t) => (t.number === b.number ? { ...t, parent: c.number }
    : t.number === c.number ? { ...t, parent: b.number } : t)) }));
  const d = tasks.create(id, { sentence: 'D' });
  assert.equal(tasks.setParent(id, d.number, b.number).parent, b.number);
});

test('a legacy task with no parent field reads as top level with no subtasks', () => {
  const id = freshProject();
  const a = tasks.create(id, { sentence: 'Old' });
  projects.mutate(id, (p) => ({ ...p, tasks: p.tasks.map((t) => { const x = { ...t }; delete x.parent; return x; }) }));
  const row = rowOf(id, a.number);
  assert.equal(row.parent, null);
  assert.deepEqual(row.subtasks, { done: 0, total: 0 });
});

test('the managed block teaches subtasks on every project line', () => {
  const id = freshProject();
  const p = projects.get(id);
  const body = projects.blockBody([p], 'someone');
  assert.match(body, /Big work: add one task for the whole thing, then its pieces under it with `[^`]* task add [^`]* "the piece" --parent <its number>`/);
});

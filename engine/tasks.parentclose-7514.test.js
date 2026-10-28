'use strict';

/**
 * kosmos#7514: a close asked `withBuilt` also closes the parent's BUILT subtasks (and theirs in turn), so a coordinator's
 * round ends with one close. A plain close takes none and says which are left (`builtLeft`). Open and held subtasks stay
 * open; a close as replaced takes none; `closedWith` names what went.
 *
 * ⚠️ SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/tasks.parentclose-7514.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pc-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pc-proj-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');
const tasks = require('../engine/tasks');
const taskchat = require('../engine/taskchat');

const rowOf = (id, n) => tasks.allTasks().find((t) => t.projectId === id && t.number === n);
function round() {
  const id = projects.create({ name: 'Round ' + Math.random().toString(36).slice(2), agents: ['rex', 'ada'] }).id;
  const top = tasks.create(id, { sentence: 'Verification round' });
  const built = tasks.create(id, { sentence: 'Seat one', parent: top.number, who: 'rex' });
  const open = tasks.create(id, { sentence: 'Seat two', parent: top.number, who: 'ada' });
  const held = tasks.create(id, { sentence: 'Seat three', parent: top.number, who: 'rex' });
  assert.equal(tasks.setBuilt(id, built.number, { by: 'rex', note: 'done' }).ok, true);
  assert.equal(tasks.setBuilt(id, held.number, { by: 'rex', note: 'done' }).ok, true);
  tasks.setOnHold(id, held.number, true);
  return { id, top, built, open, held };
}

test('kosmos#7514: a plain close takes no subtasks, and names the built ones left', () => {
  const { id, top, built, open, held } = round();
  const t = tasks.close(id, top.number);
  assert.equal(t.closedWith, undefined, 'a plain close took subtasks (built means waiting for a check, #3951)');
  assert.deepEqual(t.builtLeft, [built.number]);
  assert.equal(rowOf(id, built.number).isClosed, false);
  assert.equal(rowOf(id, open.number).isClosed, false);
  assert.equal(rowOf(id, held.number).isClosed, false);
});

test('kosmos#7514: closing withBuilt closes its built subtasks, and only those', () => {
  const { id, top, built, open, held } = round();
  const t = tasks.close(id, top.number, { withBuilt: true });
  assert.deepEqual(t.closedWith, [built.number], 'closedWith did not name exactly the built subtask');
  assert.equal(rowOf(id, top.number).isClosed, true);
  assert.equal(rowOf(id, built.number).isClosed, true, 'the built subtask stayed open under a closed parent');
  assert.equal(rowOf(id, open.number).isClosed, false, 'an open (unfinished) subtask was closed with its parent');
  assert.equal(rowOf(id, held.number).isClosed, false, 'a held subtask was closed with its parent');
  // The subtask's own history says it closed, as a close of it would.
  const line = taskchat.read(id, built.number).find((e) => e.kind === 'closed');
  assert.ok(line, 'no closed line in the subtask history');
  assert.equal(line.via, 'parent', 'the subtask history does not say it closed with its parent');
  assert.equal(line.parent, top.number);
});

test('kosmos#7514: a close as replaced takes no subtasks (that round was superseded, not done)', () => {
  const { id, top, built } = round();
  const next = tasks.create(id, { sentence: 'The next round' });
  const t = tasks.close(id, top.number, { replacedBy: next.number, withBuilt: true });
  assert.equal(t.closedWith, undefined);
  assert.equal(t.builtLeft, undefined, 'a replaced close offered to close superseded work');
  assert.equal(rowOf(id, built.number).isClosed, false, 'a replaced parent closed its built subtask as done');
});

test('kosmos#7514: nested built subtasks close too; a parent with none says nothing extra', () => {
  const id = projects.create({ name: 'Nest ' + Math.random().toString(36).slice(2), agents: ['rex'] }).id;
  const top = tasks.create(id, { sentence: 'Top' });
  const mid = tasks.create(id, { sentence: 'Mid', parent: top.number, who: 'rex' });
  const leaf = tasks.create(id, { sentence: 'Leaf', parent: mid.number, who: 'rex' });
  const openLeaf = tasks.create(id, { sentence: 'Open leaf', parent: mid.number, who: 'rex' });
  assert.equal(tasks.setBuilt(id, mid.number, { by: 'rex' }).ok, true);
  assert.equal(tasks.setBuilt(id, leaf.number, { by: 'rex' }).ok, true);
  const t = tasks.close(id, top.number, { withBuilt: true });
  assert.deepEqual(t.closedWith, [mid.number, leaf.number]);
  assert.equal(rowOf(id, openLeaf.number).isClosed, false, 'an open grandchild was closed');
  const lone = tasks.create(id, { sentence: 'No subtasks' });
  const lt = tasks.close(id, lone.number, { withBuilt: true });
  assert.equal(lt.closedWith, undefined, 'a task with no built subtasks grew a closedWith');
  assert.equal(lt.builtLeft, undefined);
});

test('kosmos#7514: reopening the parent does not reopen the subtasks closed with it (each reopens on its own)', () => {
  const { id, top, built } = round();
  tasks.close(id, top.number, { withBuilt: true });
  tasks.reopen(id, top.number);
  assert.equal(rowOf(id, top.number).isClosed, false);
  assert.equal(rowOf(id, built.number).isClosed, true);
  tasks.reopen(id, built.number);
  assert.equal(rowOf(id, built.number).isClosed, false, 'the subtask could not be reopened on its own');
});

test('kosmos#7514: a subtask whose repeat the person set is not closed with its parent', () => {
  const { id, top, built } = round();
  projects.mutate(id, (p) => ({ ...p, tasks: p.tasks.map((t) => (t.number === built.number ? { ...t, repeat: { every: 'day' }, repeatByPerson: true } : t)) }));
  const t = tasks.close(id, top.number, { withBuilt: true });
  assert.equal(t.closedWith, undefined, 'the person\'s repeat was ended by a parent close');
  assert.equal(rowOf(id, built.number).isClosed, false);
});

test('kosmos#7514: a subtask that stopped being built between the read and its write is left open', () => {
  const { id, top, built } = round();
  const real = projects.readAll;
  projects.readAll = () => { const all = real(); tasks.setOnHold(id, built.number, true); projects.readAll = real; return all; };
  try {
    const t = tasks.close(id, top.number, { withBuilt: true });
    assert.equal(t.closedWith, undefined, 'a subtask put on hold after the read was closed anyway');
    assert.equal(rowOf(id, built.number).isClosed, false);
  } finally { projects.readAll = real; }
});

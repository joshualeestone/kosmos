'use strict';

/**
 * Every open task across every project (#1382).
 *
 * Josh asked for "all tasks across all projects", reachable the way the
 * documents list is. This is the reader behind that screen.
 *
 * 🔑 THE ARM THAT MATTERS is the one separating this from `columnTasks`: the
 * column shows what somebody HOLDS and has not finished, so a task nobody has
 * picked up is invisible there. This screen is the door, and an unassigned
 * task is exactly what a person opens it to find. A test that only checked
 * "returns tasks" would pass on a function that merely called columnTasks in a
 * loop, which is the wrong screen with the right row count.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const nodePath = require('node:path');

process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-all-'));
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-all-data-'));
const projects = require('./projects');
const tasks = require('./tasks');
const fleet = require('../test-support/fleet');

/* 🛑 ASSIGNMENT REQUIRES MEMBERSHIP, and my first fixture did not know that:
   `tasks.create(p.id, { who: 'mona' })` throws "that agent is not on this
   project". A fixture I invented encoded my belief about the input; the
   suite's own shape encodes what the code actually requires. */
const ROSTER = fleet.install([
  fleet.agent('mona', { state: 'idle' }),
  fleet.agent('baron', { state: 'idle' }),
]).agents;
function assign(pid, sentence, who) {
  projects.addAgent(pid, who, ROSTER);
  return tasks.create(pid, { sentence, who }, ROSTER);
}

test('#1382: tasks from every project, each carrying the project it belongs to', () => {
  const a = projects.create({ name: 'Alpha' });
  const b = projects.create({ name: 'Beta' });
  assign(a.id, 'Write the copy', 'mona');
  assign(b.id, 'Ship the cut', 'baron');

  const all = tasks.allTasks();
  /* CONTROL: a reader that found nothing would satisfy every "not present"
     assertion below for the wrong reason. */
  assert.ok(all.length >= 2, 'the reader returned nothing, so nothing below is a test');

  const names = all.map((t) => t.projectName).sort();
  assert.deepEqual(names.filter((n) => n === 'Alpha' || n === 'Beta').length, 2,
    'a task lost its project name, so the screen cannot say where a row belongs');
  assert.ok(all.every((t) => t.projectId), 'a row has no project id to link back to');
});

test('#1382: an UNASSIGNED task is included, which is what makes this not the column', () => {
  const p = projects.create({ name: 'Unpicked' });
  tasks.create(p.id, { sentence: 'Nobody has this yet' });

  const mine = tasks.allTasks().filter((t) => t.projectName === 'Unpicked');
  assert.equal(mine.length, 1, 'an unassigned task is missing: this is showing the column, not the door');

  /* The discriminating pair, in one test: the same task, both readers. */
  const stored = projects.readAll().find((x) => x.id === p.id);
  assert.equal(tasks.columnTasks(stored).length, 0,
    'the column now shows unassigned tasks, so this test no longer separates the two readers');
});

/**
 * 🔑 CLOSED TASKS ARE IN, AND THIS IS THE TEST THAT SAYS WHY.
 *
 * The screen is reached from `#pj-alltasks`, the per-project door that today
 * reveals hidden tasks in place. #1009 already put every OPEN task in the
 * column, so what that door reveals now is FINISHED WORK. Repurposing it
 * without carrying closed tasks across would leave finished work unreachable
 * anywhere in the product.
 */
test('#1382: a CLOSED task is INCLUDED and says so, because this screen inherits its only door', () => {
  const p = projects.create({ name: 'Mixed' });
  const open = assign(p.id, 'Still going', 'mona');
  const done = assign(p.id, 'Finished', 'mona');
  tasks.close(p.id, done.number);

  const mine = tasks.allTasks().filter((t) => t.projectName === 'Mixed');
  assert.equal(mine.length, 2, 'a task went missing: closed work must survive the repurpose');
  const closed = mine.find((t) => t.number === done.number);
  const live = mine.find((t) => t.number === open.number);
  assert.ok(closed, 'the closed task is gone, so finished work is now unreachable');
  assert.equal(closed.isClosed, true, 'the closed task does not say it is closed, so the screen cannot show it differently');
  assert.equal(live.isClosed, false, 'an open task is marked closed');
});

test('#1382: open work sorts above finished work', () => {
  const rows = tasks.allTasks();
  const firstClosed = rows.findIndex((t) => t.isClosed);
  const lastOpen = rows.map((t) => t.isClosed).lastIndexOf(false);
  /* CONTROL: with none of one kind this ordering claim is vacuous. */
  assert.ok(firstClosed > -1, 'no closed task exists, so the ordering is untested');
  assert.ok(lastOpen > -1, 'no open task exists, so the ordering is untested');
  assert.ok(lastOpen < firstClosed, 'a finished task sorts above a live one');
});

test('#1382: whoNames is ADDED, and the task keeps its own fields', () => {
  const p = projects.create({ name: 'Naming' });
  const t = assign(p.id, 'Check the shape', 'mona');

  const row = tasks.allTasks().find((x) => x.projectName === 'Naming');
  assert.ok(Array.isArray(row.whoNames), 'whoNames is not a list');
  assert.deepEqual(row.whoNames, ['mona']);
  assert.equal(row.sentence, 'Check the shape', 'the task lost a field it owns');
  assert.equal(row.number, t.number, 'the task number did not survive');
});

test('#1382: the order is stable, and names sort within each half', () => {
  /* 🛑 A CONTROL ON THE KEY ITSELF. This test first sorted on `t.n`, a field
     that DOES NOT EXIST: both reads returned undefined, compared equal, and it
     PASSED while proving nothing. The field is `number`. */
  assert.ok(tasks.allTasks().every((t) => typeof t.number === 'number'),
    'the ordering key is not a number on every row, so the comparison below is vacuous');

  const one = tasks.allTasks().map((t) => (t.isClosed ? 'z' : 'a') + '|' + t.projectName + '#' + t.number);
  const two = tasks.allTasks().map((t) => (t.isClosed ? 'z' : 'a') + '|' + t.projectName + '#' + t.number);
  assert.deepEqual(one, two, 'two reads gave different orders');
  assert.ok(one.length > 1, 'only one row exists, so ordering is untested');

  /* ⚠️ NAME ORDER HOLDS WITHIN EACH HALF, NOT ACROSS THE WHOLE LIST. The
     earlier version of this assertion asserted it globally, and went red the
     moment closed tasks joined and sorted last. That was the test encoding an
     old promise, not the sort being wrong. */
  for (const half of [false, true]) {
    const names = tasks.allTasks().filter((t) => t.isClosed === half).map((t) => t.projectName);
    assert.deepEqual(names, names.slice().sort((a, b) => a.localeCompare(b)),
      `projects are not in name order within the ${half ? 'closed' : 'open'} half`);
  }
});

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

  const all = tasks.allOpenTasks();
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

  const mine = tasks.allOpenTasks().filter((t) => t.projectName === 'Unpicked');
  assert.equal(mine.length, 1, 'an unassigned task is missing: this is showing the column, not the door');

  /* The discriminating pair, in one test: the same task, both readers. */
  const stored = projects.readAll().find((x) => x.id === p.id);
  assert.equal(tasks.columnTasks(stored).length, 0,
    'the column now shows unassigned tasks, so this test no longer separates the two readers');
});

test('#1382: a CLOSED task is left out, and the reader still returns the open ones', () => {
  const p = projects.create({ name: 'Mixed' });
  const open = assign(p.id, 'Still going', 'mona');
  const done = assign(p.id, 'Finished', 'mona');
  tasks.close(p.id, done.number);

  const mine = tasks.allOpenTasks().filter((t) => t.projectName === 'Mixed');
  assert.equal(mine.length, 1, 'the closed task came through, or the open one did not');
  assert.equal(mine[0].number, open.number, 'the wrong task survived the filter');
});

test('#1382: whoNames is ADDED, and the task keeps its own fields', () => {
  const p = projects.create({ name: 'Naming' });
  const t = assign(p.id, 'Check the shape', 'mona');

  const row = tasks.allOpenTasks().find((x) => x.projectName === 'Naming');
  assert.ok(Array.isArray(row.whoNames), 'whoNames is not a list');
  assert.deepEqual(row.whoNames, ['mona']);
  assert.equal(row.sentence, 'Check the shape', 'the task lost a field it owns');
  assert.equal(row.number, t.number, 'the task number did not survive');
});

test('#1382: the order is stable, so the screen does not reshuffle between paints', () => {
  /* 🛑 A CONTROL ON THE KEY ITSELF. This test first sorted on `t.n`, a field
     that DOES NOT EXIST: both reads returned undefined, compared equal, and it
     PASSED while proving nothing. The field is `number`. */
  assert.ok(tasks.allOpenTasks().every((t) => typeof t.number === 'number'),
    'the ordering key is not a number on every row, so the comparison below is vacuous');
  const one = tasks.allOpenTasks().map((t) => t.projectName + '#' + t.number);
  const two = tasks.allOpenTasks().map((t) => t.projectName + '#' + t.number);
  assert.deepEqual(one, two, 'two reads gave different orders');
  const sorted = one.slice().sort((a, b) => a.localeCompare(b));
  assert.ok(one.length > 1, 'only one row exists, so ordering is untested');
  assert.deepEqual(one.map((s) => s.split('#')[0]), sorted.map((s) => s.split('#')[0]),
    'projects are not in name order');
});

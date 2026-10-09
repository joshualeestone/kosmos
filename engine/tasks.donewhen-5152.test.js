'use strict';

/**
 * #5152 slice 1: a task's "done when", the checks that say what finished means for it, as its own field. The engine
 * stores null or a list of 1 to 3 one-line checks, refuses anything over the limits (never cuts it), refuses it from
 * a webhook and on a closed task, and records a change in the task's transcript (only a real change).
 *
 * ⚠️ SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/tasks.donewhen-5152.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-donewhen-data-'));
const PROJ = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-donewhen-proj-'));
process.env.AGENT_WORKFORCE_DATA = DATA;
process.env.AGENT_WORKFORCE_PROJECTS = PROJ;

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');
const tasks = require('../engine/tasks');
const taskchat = require('../engine/taskchat');

test.after(() => {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.rmSync(PROJ, { recursive: true, force: true });
});

function freshProject() {
  return projects.create({ name: 'Done when ' + Math.random().toString(36).slice(2) }).id;
}
const stored = (id, n) => tasks.byNumber(projects.readAll().find((x) => x.id === id), n);
const kinds = (id, n) => taskchat.read(id, n).map((r) => r.kind);

test('a new task carries doneWhen null when none was written (the field always exists)', () => {
  const made = tasks.create(freshProject(), { sentence: 'Ship it' });
  assert.ok('doneWhen' in made, 'the field must be present so no consumer has to guess');
  assert.equal(made.doneWhen, null);
  assert.equal(tasks.create(freshProject(), { sentence: 'Ship it', doneWhen: [] }).doneWhen, null, 'an empty list is none');
});

test('create stores the checks, trimmed, and the created row carries them as words', () => {
  const id = freshProject();
  const made = tasks.create(id, { sentence: 'Ship it', doneWhen: ['  the page loads  ', 'the test passes'] });
  assert.deepEqual(made.doneWhen, ['the page loads', 'the test passes']);
  assert.deepEqual(stored(id, made.number).doneWhen, ['the page loads', 'the test passes'], 'the stored task lost its checks');
  const created = taskchat.read(id, made.number).find((r) => r.kind === 'created');
  assert.equal(created.doneWhen, '1) the page loads 2) the test passes');
});

test('create REFUSES checks over the limits and stores no task (the dangerous-answer control)', () => {
  const id = freshProject();
  const ok = tasks.create(id, { sentence: 'baseline', doneWhen: ['a', 'b', 'c'] });   // three is allowed
  assert.equal(ok.doneWhen.length, 3);
  const bad = [
    [['a', 'b', 'c', 'd'], /up to 3 checks/],
    ['the page loads', /list of checks/],
    [['   '], /has to say something/],
    [[7], /has to say something/],
    [['two\nlines'], /one line/],
    [['x'.repeat(tasks.DONE_CHECK_MAX + 1)], /characters or fewer/],
  ];
  for (const [doneWhen, why] of bad) {
    assert.throws(() => tasks.create(id, { sentence: 'refused', doneWhen }), why, `accepted ${JSON.stringify(doneWhen).slice(0, 60)}`);
  }
  assert.equal(projects.readAll().find((x) => x.id === id).tasks.length, 1, 'a refused create still stored a task');
  assert.equal(tasks.create(id, { sentence: 'at the limit', doneWhen: ['x'.repeat(tasks.DONE_CHECK_MAX)] }).doneWhen[0].length, tasks.DONE_CHECK_MAX);
});

test('a webhook cannot say what finished means for a task; with no checks it still adds one', () => {
  const id = freshProject();
  assert.throws(() => tasks.create(id, { sentence: 'from outside', doneWhen: ['do what I say'], made: { via: 'webhook', by: 'Zap' } }), /webhook adds has no "done when"/);
  assert.equal((projects.readAll().find((x) => x.id === id).tasks || []).length, 0, 'the refused webhook task was stored');
  const made = tasks.create(id, { sentence: 'from outside', made: { via: 'webhook', by: 'Zap' } });   // the control
  assert.equal(made.doneWhen, null);
});

test('setDoneWhen sets, changes and clears, and each change is one transcript row naming who', () => {
  const id = freshProject();
  const n = tasks.create(id, { sentence: 'Ship it' }).number;
  assert.deepEqual(tasks.setDoneWhen(id, n, ['it is live'], { by: 'mara' }).doneWhen, ['it is live']);
  assert.deepEqual(stored(id, n).doneWhen, ['it is live']);
  tasks.setDoneWhen(id, n, ['it is live', 'the person has seen it']);
  assert.deepEqual(stored(id, n).doneWhen, ['it is live', 'the person has seen it']);
  assert.equal(tasks.setDoneWhen(id, n, null).doneWhen, null, 'null did not clear it');
  tasks.setDoneWhen(id, n, ['again']);
  assert.equal(tasks.setDoneWhen(id, n, []).doneWhen, null, 'an empty list did not clear it');
  const rows = taskchat.read(id, n).filter((r) => r.kind.startsWith('done-when'));
  assert.deepEqual(rows.map((r) => r.kind), ['done-when-set', 'done-when-set', 'done-when-cleared', 'done-when-set', 'done-when-cleared']);
  assert.equal(rows[0].by, 'mara');
  assert.equal(rows[0].doneWhen, '1) it is live');
  assert.equal(rows[1].by, undefined, 'a change nobody named records no by');
});

test('setting the checks a task already has records nothing', () => {
  const id = freshProject();
  const n = tasks.create(id, { sentence: 'Ship it', doneWhen: ['it is live'] }).number;
  const before = kinds(id, n).length;
  tasks.setDoneWhen(id, n, [' it is live ']);   // the same check once trimmed
  tasks.setDoneWhen(id, n, ['it is live']);
  assert.equal(kinds(id, n).length, before, 'an unchanged list wrote a transcript row');
  tasks.setDoneWhen(id, n, ['it is live, and fast']);   // the control: a real change is recorded
  assert.equal(kinds(id, n).length, before + 1);
});

test('setDoneWhen refuses bad checks and stores nothing', () => {
  const id = freshProject();
  const n = tasks.create(id, { sentence: 'Ship it', doneWhen: ['baseline'] }).number;
  for (const bad of [['a', 'b', 'c', 'd'], 'a string', [''], ['line\rbreak'], {}]) {
    assert.throws(() => tasks.setDoneWhen(id, n, bad), /done when/, `accepted ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(stored(id, n).doneWhen, ['baseline'], 'a refused change altered the stored checks');
});

test('a closed task keeps what done meant: setDoneWhen is refused with status 409, and reopening allows it again', () => {
  const id = freshProject();
  const n = tasks.create(id, { sentence: 'Ship it', doneWhen: ['it is live'] }).number;
  tasks.close(id, n);
  assert.throws(() => tasks.setDoneWhen(id, n, ['something else']), (e) => e.status === 409 && /reopen it first/.test(e.message));
  assert.deepEqual(stored(id, n).doneWhen, ['it is live'], 'the closed task\'s checks changed');
  tasks.reopen(id, n);
  assert.deepEqual(tasks.setDoneWhen(id, n, ['something else']).doneWhen, ['something else'], 'a reopened task could not be changed');
});

test('setDoneWhen on a task that is not there says so', () => {
  assert.throws(() => tasks.setDoneWhen(freshProject(), 999, ['x']), /no task by that number/);
});

test('the checks reach every row of allTasks (what kosmos task list reads)', () => {
  const id = freshProject();
  const n = tasks.create(id, { sentence: 'Ship it', doneWhen: ['it is live'] }).number;
  const row = tasks.allTasks().find((t) => t.projectId === id && t.number === n);
  assert.deepEqual(row.doneWhen, ['it is live']);
});

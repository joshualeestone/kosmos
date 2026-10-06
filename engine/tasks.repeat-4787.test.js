'use strict';

/**
 * kosmos#4787: a repeating task (tasks.setRepeat) and its runs (tasks.recordRun). The rule is checked whole and stored
 * normalised; a run is kept as lastRunAt / lastRunBy / lastRunNote and recorded in the task's conversation; a one-off or
 * closed task refuses a run; the board's state for a repeating task is its owner's, never "Unassigned".
 *
 * ⚠️ SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/tasks.repeat-4787.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rep-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rep-proj-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');
const tasks = require('../engine/tasks');
const taskchat = require('../engine/taskchat');

function freshTask() {
  const p = projects.create({ name: 'Rep ' + Math.random().toString(36).slice(2) });
  const made = tasks.create(p.id, { sentence: 'Check the listings' });
  return { id: p.id, n: made.number };
}
const stored = (id, n) => tasks.byNumber(projects.readAll().find((x) => x.id === id), n);

test('#4787: setRepeat stores the rule normalised, records it once, and clears it', () => {
  const { id, n } = freshTask();
  tasks.setRepeat(id, n, { every: 'day', at: '09:00', junk: 1 });
  assert.deepEqual(stored(id, n).repeat, { every: 'day', at: '09:00' }, 'only the rule\'s own fields are stored');
  tasks.setRepeat(id, n, { every: 'day', at: '09:00' });   // the same rule again: no second event
  assert.equal(taskchat.read(id, n).filter((e) => e.kind === 'repeat-set').length, 1);
  assert.equal(taskchat.read(id, n).find((e) => e.kind === 'repeat-set').words, 'every day at 9am');
  tasks.setRepeat(id, n, null);
  assert.equal('repeat' in stored(id, n), false, 'cleared: the field goes');
  assert.ok(taskchat.read(id, n).some((e) => e.kind === 'repeat-cleared'));
});

test('#4787: setRepeat refuses a bad rule whole, and a closed task', () => {
  const { id, n } = freshTask();
  assert.throws(() => tasks.setRepeat(id, n, { every: 'day', at: '9am' }), /HH:MM/);
  assert.equal('repeat' in stored(id, n), false, 'nothing stored on a refusal');
  tasks.close(id, n);
  assert.throws(() => tasks.setRepeat(id, n, { every: 'hour' }), /closed/);
  tasks.setRepeat(id, n, null);   // CONTROL: clearing a closed task's (absent) rule is allowed, nothing to refuse
});

test('#4787: recordRun keeps the latest run and records each one; a one-off or closed task refuses a run', () => {
  const { id, n } = freshTask();
  assert.throws(() => tasks.recordRun(id, n, 'ada', 'x'), /does not repeat/, 'a one-off task is closed, not run');
  tasks.setRepeat(id, n, { every: 'hour', minute: 15 });
  const at = Date.parse('2026-10-06T09:16:00Z');
  tasks.recordRun(id, n, 'ada', '  found 3   new listings ', at);
  let t = stored(id, n);
  assert.equal(t.lastRunAt, '2026-10-06T09:16:00.000Z');
  assert.equal(t.lastRunBy, 'ada');
  assert.equal(t.lastRunNote, 'found 3 new listings', 'one line, trimmed');
  tasks.recordRun(id, n, 'ada', '', at + 3600000);
  t = stored(id, n);
  assert.equal('lastRunNote' in t, false, 'a run with no note does not keep the previous run\'s note');
  const runs = taskchat.read(id, n).filter((e) => e.kind === 'run');
  assert.equal(runs.length, 2, 'every run is in the conversation');
  assert.equal(runs[0].note, 'found 3 new listings');
  assert.throws(() => tasks.recordRun(id, n, 'ada', 'x'.repeat(501)), /at most/);
  tasks.close(id, n);
  assert.throws(() => tasks.recordRun(id, n, 'ada', ''), /closed/);
});

test('#4787: a repeating task given to its agent is not "nobody": the board groups it with its owner', () => {
  const p = projects.create({ name: 'Own ' + Math.random().toString(36).slice(2), agents: ['ada'] });
  const made = tasks.create(p.id, { sentence: 'Hourly monitor', who: 'ada' });
  tasks.setRepeat(p.id, made.number, { every: 'hour' });
  const t = stored(p.id, made.number);
  assert.notEqual(tasks.taskState(t), 'nobody');
  const loose = tasks.create(p.id, { sentence: 'Nobody runs this' });
  tasks.setRepeat(p.id, loose.number, { every: 'hour' });
  assert.equal(tasks.taskState(stored(p.id, loose.number)), 'nobody', 'CONTROL: a repeating task with no owner is still Unassigned (repeat is not ownership)');
});

'use strict';

/**
 * #4786: lastProgressAt, the "work moved forward" signal the room's back-and-forth valve treats as a landing.
 * Only a FIRST-TIME step forward counts, because anything repeatable could be looped (review round 1): a part
 * passed A to B to A, a task closed, reopened and closed again, a built mark taken off and put back.
 * Each case writes rows with chosen times straight into the task's file, so the time each rule returns is exact.
 *
 * ⚠️ SANDBOX THE DATA ROOT BEFORE REQUIRING anything that reads it.
 *
 *   node --test engine/taskchat.progress-4786.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-progress-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-progress-proj-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const taskchat = require('../engine/taskchat');

const T0 = Date.parse('2026-09-30T12:00:00.000Z');
const at = (minutes) => new Date(T0 + minutes * 60000).toISOString();
let seq = 0;

/* A fresh project whose task 1 carries exactly `rows` ({ m: minutes after T0, ...event }). */
function project(rows) {
  seq += 1;
  const id = 'progress-' + seq;
  const file = taskchat.taskChatFile(id, 1);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map(({ m, ...e }) => JSON.stringify({ at: at(m), ...e })).join('\n') + '\n');
  return id;
}
const NOW = T0 + 60 * 60000;

test('#4786: a task made, a part added, and the first close each count', () => {
  assert.equal(taskchat.lastProgressAt(project([{ m: 1, kind: 'created', who: null }]), NOW), T0 + 60000);
  assert.equal(taskchat.lastProgressAt(project([{ m: 1, kind: 'created' }, { m: 2, kind: 'part-added', partId: 2 }]), NOW), T0 + 2 * 60000);
  assert.equal(taskchat.lastProgressAt(project([{ m: 1, kind: 'created' }, { m: 3, kind: 'closed' }]), NOW), T0 + 3 * 60000);
});

test('#4786: talk, going backwards, and other lifecycle rows do not count', () => {
  for (const kind of ['said', 'reopened', 'part-reopened', 'unbuilt', 'due-set', 'parent-set']) {
    const id = project([{ m: 1, kind: 'created' }, { m: 5, kind, partId: 1, text: 'x' }]);
    assert.equal(taskchat.lastProgressAt(id, NOW), T0 + 60000, `'${kind}' counted as work moving`);
  }
});

test('#4786: closing again after a reopen is not new progress (a close/reopen loop cannot release the room)', () => {
  const id = project([{ m: 1, kind: 'created' }, { m: 2, kind: 'closed' }, { m: 3, kind: 'reopened' }, { m: 4, kind: 'closed' }]);
  assert.equal(taskchat.lastProgressAt(id, NOW), T0 + 2 * 60000);
  const part = project([{ m: 1, kind: 'created' }, { m: 2, kind: 'part-closed', partId: 1 },
    { m: 3, kind: 'part-reopened', partId: 1 }, { m: 4, kind: 'part-closed', partId: 1 }]);
  assert.equal(taskchat.lastProgressAt(part, NOW), T0 + 2 * 60000);
  // A DIFFERENT part closing for the first time is new progress.
  const other = project([{ m: 1, kind: 'created' }, { m: 2, kind: 'part-closed', partId: 1 }, { m: 4, kind: 'part-closed', partId: 2 }]);
  assert.equal(taskchat.lastProgressAt(other, NOW), T0 + 4 * 60000);
});

test('#4786: a built mark put back after unbuilt is not new progress', () => {
  const id = project([{ m: 1, kind: 'created' }, { m: 2, kind: 'built' }, { m: 3, kind: 'unbuilt' }, { m: 4, kind: 'built' }]);
  assert.equal(taskchat.lastProgressAt(id, NOW), T0 + 2 * 60000);
});

test('#4786: handing a part to someone new counts; handing it back does not', () => {
  const pipeline = project([{ m: 1, kind: 'created', who: 'leo' }, { m: 2, kind: 'assigned', partId: 1, who: 'mara' },
    { m: 3, kind: 'assigned', partId: 1, who: 'ada' }]);
  assert.equal(taskchat.lastProgressAt(pipeline, NOW), T0 + 3 * 60000, 'a handoff down the line did not count');
  const backAndForth = project([{ m: 1, kind: 'created', who: 'leo' }, { m: 2, kind: 'assigned', partId: 1, who: 'mara' },
    { m: 3, kind: 'assigned', partId: 1, who: 'leo' }, { m: 4, kind: 'assigned', partId: 1, who: 'mara' }]);
  assert.equal(taskchat.lastProgressAt(backAndForth, NOW), T0 + 2 * 60000, 'passing a part back and forth counted');
  const takenOff = project([{ m: 1, kind: 'created', who: 'leo' }, { m: 2, kind: 'assigned', partId: 1, who: null }]);
  assert.equal(taskchat.lastProgressAt(takenOff, NOW), T0 + 60000, 'taking someone off counted');
});

test('#4786: a row dated in the future is clamped to now, so it cannot switch the valve off', () => {
  const id = project([{ m: 1, kind: 'created' }, { m: 60 * 24 * 365, kind: 'closed' }]);
  assert.equal(taskchat.lastProgressAt(id, NOW), NOW);
});

test('#4786: another project\'s files, a missing folder, and a bad project id read as nothing', () => {
  const id = project([{ m: 7, kind: 'created' }]);
  assert.equal(taskchat.lastProgressAt(id + '-b', NOW), 0);
  assert.equal(taskchat.lastProgressAt('', NOW), 0);
  assert.equal(taskchat.lastProgressAt('../escape', NOW), 0);
});

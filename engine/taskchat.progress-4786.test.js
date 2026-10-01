'use strict';

/**
 * #4786: progressTimes, the "work moved forward" steps the room's back-and-forth valve gives a bounded allowance for.
 * Only a FIRST-TIME step forward counts, because anything repeatable could be looped (review round 1): a part
 * passed A to B to A, a task closed, reopened and closed again, a built mark taken off and put back.
 * Each case writes rows with chosen times straight into the task's file, so the time each rule returns is exact.
 *
 * ⚠️ SANDBOX THE DATA ROOT BEFORE REQUIRING anything that reads it.
 *
 *   node --test engine/taskchat.progress-4786.test.js
 */
require('../test-support/tmpscope'); // #4273: this file's temp dirs go with the process
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-progress-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-progress-proj-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');
const tasks = require('../engine/tasks');
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
const newest = (id) => { const t = taskchat.progressTimes(id, NOW); return t.length ? t[t.length - 1] : 0; };
const M = (m) => T0 + m * 60000;

test('#4786: a task made, a part added, and the first close each count', () => {
  assert.equal(newest(project([{ m: 1, kind: 'created', who: null }])), T0 + 60000);
  assert.equal(newest(project([{ m: 1, kind: 'created' }, { m: 2, kind: 'part-added', partId: 2 }])), T0 + 2 * 60000);
  assert.equal(newest(project([{ m: 1, kind: 'created' }, { m: 3, kind: 'closed' }])), T0 + 3 * 60000);
});

test('#4786: talk, going backwards, and other lifecycle rows do not count', () => {
  for (const kind of ['said', 'reopened', 'part-reopened', 'unbuilt', 'due-set', 'parent-set']) {
    const id = project([{ m: 1, kind: 'created' }, { m: 5, kind, partId: 1, text: 'x' }]);
    assert.equal(newest(id), T0 + 60000, `'${kind}' counted as work moving`);
  }
});

test('#4786: closing again after a reopen is not new progress (a close/reopen loop cannot release the room)', () => {
  const id = project([{ m: 1, kind: 'created' }, { m: 2, kind: 'closed' }, { m: 3, kind: 'reopened' }, { m: 4, kind: 'closed' }]);
  assert.equal(newest(id), T0 + 2 * 60000);
  const part = project([{ m: 1, kind: 'created' }, { m: 2, kind: 'part-closed', partId: 1 },
    { m: 3, kind: 'part-reopened', partId: 1 }, { m: 4, kind: 'part-closed', partId: 1 }]);
  assert.equal(newest(part), T0 + 2 * 60000);
  // A DIFFERENT part closing for the first time is new progress.
  const other = project([{ m: 1, kind: 'created' }, { m: 2, kind: 'part-closed', partId: 1 }, { m: 4, kind: 'part-closed', partId: 2 }]);
  assert.equal(newest(other), T0 + 4 * 60000);
});

test('#4786: a built mark put back after unbuilt is not new progress', () => {
  const id = project([{ m: 1, kind: 'created' }, { m: 2, kind: 'built' }, { m: 3, kind: 'unbuilt' }, { m: 4, kind: 'built' }]);
  assert.equal(newest(id), T0 + 2 * 60000);
});

test('#4786: handing a part to someone new counts; handing it back does not', () => {
  const pipeline = project([{ m: 1, kind: 'created', who: 'leo' }, { m: 2, kind: 'assigned', partId: 1, who: 'mara' },
    { m: 3, kind: 'assigned', partId: 1, who: 'ada' }]);
  assert.equal(newest(pipeline), T0 + 3 * 60000, 'a handoff down the line did not count');
  const backAndForth = project([{ m: 1, kind: 'created', who: 'leo' }, { m: 2, kind: 'assigned', partId: 1, who: 'mara' },
    { m: 3, kind: 'assigned', partId: 1, who: 'leo' }, { m: 4, kind: 'assigned', partId: 1, who: 'mara' }]);
  assert.equal(newest(backAndForth), T0 + 2 * 60000, 'passing a part back and forth counted');
  const takenOff = project([{ m: 1, kind: 'created', who: 'leo' }, { m: 2, kind: 'assigned', partId: 1, who: null }]);
  assert.equal(newest(takenOff), T0 + 60000, 'taking someone off counted');
});

test('#4786: a row dated in the future is skipped, so it cannot earn room in every later window', () => {
  const id = project([{ m: 1, kind: 'created' }, { m: 60 * 24 * 365, kind: 'closed' }]);
  assert.deepEqual(taskchat.progressTimes(id, NOW), [M(1)]);
  const atNow = project([{ m: 1, kind: 'created' }, { m: 60, kind: 'closed' }]);
  assert.deepEqual(taskchat.progressTimes(atNow, NOW), [M(1), NOW], 'a row dated exactly now was skipped');
});

test('#4786: a task file last written before `since` is not read; one written since is', () => {
  const id = project([{ m: 1, kind: 'created' }, { m: 2, kind: 'closed' }]);
  const file = taskchat.taskChatFile(id, 1);
  fs.utimesSync(file, new Date(M(2)), new Date(M(2)));
  assert.deepEqual(taskchat.progressTimes(id, NOW, M(3)), [], 'a file untouched since `since` was read');
  assert.deepEqual(taskchat.progressTimes(id, NOW, M(2)), [M(1), M(2)], 'CONTROL: a file written at `since` was skipped');
});

test('#4786: another project\'s files, a missing folder, and a bad project id read as nothing', () => {
  const id = project([{ m: 7, kind: 'created' }]);
  assert.equal(newest(id + '-b'), 0);
  assert.deepEqual(taskchat.progressTimes('', NOW), []);
  assert.deepEqual(taskchat.progressTimes('../escape', NOW), []);
});

test('#4786: each counted step is listed once, oldest first, so the valve can count them', () => {
  const id = project([{ m: 1, kind: 'created', who: 'leo' }, { m: 2, kind: 'part-added', partId: 2, who: 'mara' },
    { m: 3, kind: 'said', text: 'x' }, { m: 4, kind: 'part-closed', partId: 2 }, { m: 5, kind: 'part-closed', partId: 2 }]);
  assert.deepEqual(taskchat.progressTimes(id, NOW), [M(1), M(2), M(4)]);
});

test('#4786: holders are per part: an added part\'s first holder is who it was added for; the task\'s first holder holds part 1 only', () => {
  // Part 2 added for mara, given to ada, given back to mara: the give-back is not new.
  const back = project([{ m: 1, kind: 'created', who: 'leo' }, { m: 2, kind: 'part-added', partId: 2, who: 'mara' },
    { m: 3, kind: 'assigned', partId: 2, who: 'ada' }, { m: 4, kind: 'assigned', partId: 2, who: 'mara' }]);
  assert.deepEqual(taskchat.progressTimes(back, NOW), [M(1), M(2), M(3)]);
  // leo made the task, so leo held part 1; part 2 reaching leo is still a first for PART 2.
  const toFirst = project([{ m: 1, kind: 'created', who: 'leo' }, { m: 2, kind: 'part-added', partId: 2, who: null },
    { m: 3, kind: 'assigned', partId: 2, who: 'leo' }]);
  assert.deepEqual(taskchat.progressTimes(toFirst, NOW), [M(1), M(2), M(3)]);
});

test('#4786: the real pipeline, through engine/tasks: finish a part, close it, hand the next part on: each step counts', () => {
  const p = projects.create({ name: 'Pipe ' + Math.random().toString(36).slice(2), agents: ['leo', 'mara', 'ada'] });
  const made = tasks.create(p.id, { sentence: 'Draft, check, send', who: 'leo' });
  const two = tasks.addPart(p.id, made.number, { sentence: 'check it' });
  assert.equal(two.ok, true, two.because || '');
  const partTwo = tasks.partsOf(two.task).find((x) => x.sentence === 'check it');
  const before = taskchat.progressTimes(p.id).length;   // created + part-added
  assert.equal(before, 2);
  tasks.setPartClosed(p.id, made.number, 1, new Date().toISOString());
  assert.equal(tasks.assignPart(p.id, made.number, partTwo.id, 'mara').ok, true);
  assert.equal(taskchat.progressTimes(p.id).length, 4, 'closing part 1 and handing part 2 to mara were not both counted');
  // The loop shape through the same functions: reopen part 1, close it again, hand part 2 back to leo and on to mara.
  tasks.setPartClosed(p.id, made.number, 1, null);
  tasks.setPartClosed(p.id, made.number, 1, new Date().toISOString());
  tasks.assignPart(p.id, made.number, partTwo.id, 'leo');
  const afterLoop = taskchat.progressTimes(p.id).length;
  tasks.assignPart(p.id, made.number, partTwo.id, 'mara');
  assert.equal(taskchat.progressTimes(p.id).length, afterLoop, 'handing part 2 back to mara counted again');
  assert.equal(afterLoop, 5, 'only leo getting part 2 for the first time should have counted in the loop');
});

test('#4786: through engine/tasks, a task made for leo has leo holding part 1, so giving part 1 back to leo is not new', () => {
  const p = projects.create({ name: 'Held ' + Math.random().toString(36).slice(2), agents: ['leo', 'mara'] });
  const made = tasks.create(p.id, { sentence: 'Write it', who: 'leo' });
  const part1 = tasks.partsOf(made)[0];
  assert.equal(tasks.assignPart(p.id, made.number, part1.id, 'mara').ok, true);
  const afterMara = taskchat.progressTimes(p.id).length;
  assert.equal(afterMara, 2, 'made + handed to mara should be two steps');
  assert.equal(tasks.assignPart(p.id, made.number, part1.id, 'leo').ok, true);
  assert.equal(taskchat.progressTimes(p.id).length, afterMara, 'giving part 1 back to the task\'s maker counted as new');
});

test('#4786: a row from before parts (no partId) is the task\'s one part', () => {
  const id = project([{ m: 1, kind: 'created', who: 'leo' }, { m: 2, kind: 'assigned', who: 'mara' }, { m: 3, kind: 'assigned', who: 'leo' }]);
  assert.deepEqual(taskchat.progressTimes(id, NOW), [M(1), M(2)]);
});

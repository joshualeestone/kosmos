'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273: CI fails a run that leaves them)

/**
 * kosmos#5643: a recurring task's runs that found nothing new. A run is UNCHANGED when it says so (--unchanged) or when its
 * note is the same text as the run before it; the task keeps the last change apart from the last run and counts the
 * unchanged runs in a row, and each run's transcript row says whether it was unchanged.
 *
 *   node --test engine/tasks.runrollup-5643.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-roll-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-roll-proj-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');
const tasks = require('../engine/tasks');
const taskchat = require('../engine/taskchat');

const T0 = Date.parse('2026-10-09T04:00:00Z');
const MIN = 60000;
function freshRepeating() {
  const p = projects.create({ name: 'Roll ' + Math.random().toString(36).slice(2) });
  const n = tasks.create(p.id, { sentence: 'Watch the listings' }).number;
  tasks.setRepeat(p.id, n, { every: 'hour' });   // on the hour
  return { id: p.id, n };
}
const stored = (id, n) => tasks.byNumber(projects.readAll().find((x) => x.id === id), n);
const runs = (id, n) => taskchat.read(id, n).filter((e) => e.kind === 'run');

test('#5643: --unchanged marks a run; the last change and the count in a row are kept apart from the last run', () => {
  const { id, n } = freshRepeating();
  tasks.recordRun(id, n, 'mara', 'found 3 new listings', T0);
  let t = stored(id, n);
  assert.equal(t.lastChangeNote, 'found 3 new listings');
  assert.equal(t.lastChangeAt, new Date(T0).toISOString());
  assert.equal(t.unchangedRuns, undefined, 'a run that changed something counted as unchanged');
  tasks.recordRun(id, n, 'mara', 'checked the feed', T0 + 60 * MIN, { unchanged: true });
  tasks.recordRun(id, n, 'mara', '', T0 + 120 * MIN, { unchanged: true });
  t = stored(id, n);
  assert.equal(t.unchangedRuns, 2);
  assert.equal(t.lastRunUnchanged, true);
  assert.equal(t.lastChangeAt, new Date(T0).toISOString(), 'an unchanged run moved the last change');
  assert.equal(t.lastChangeNote, 'found 3 new listings');
  assert.equal(t.lastRunAt, new Date(T0 + 120 * MIN).toISOString(), 'the last run did not move');
  assert.deepEqual(runs(id, n).map((e) => e.unchanged === true), [false, true, true]);
  assert.equal(runs(id, n)[1].note, 'checked the feed', 'an unchanged run lost its text (the history keeps it)');
});

test('#5643: a note that repeats the run before it is unchanged with no flag; a different note is a change and resets the count', () => {
  const { id, n } = freshRepeating();
  tasks.recordRun(id, n, 'mara', 'all clear', T0);
  tasks.recordRun(id, n, 'mara', '  all   clear ', T0 + 60 * MIN);   // whitespace aside, the same text
  tasks.recordRun(id, n, 'mara', 'all clear', T0 + 120 * MIN);
  assert.equal(stored(id, n).unchangedRuns, 2);
  tasks.recordRun(id, n, 'mara', 'one listing is down', T0 + 180 * MIN);
  const t = stored(id, n);
  assert.equal(t.unchangedRuns, undefined, 'the count survived a change');
  assert.equal(t.lastRunUnchanged, undefined);
  assert.equal(t.lastChangeNote, 'one listing is down');
  assert.equal(t.lastChangeAt, new Date(T0 + 180 * MIN).toISOString());
});

test('#5643: a run with no note and no flag is not unchanged (nothing says so), and the first run is never unchanged by repetition', () => {
  const { id, n } = freshRepeating();
  tasks.recordRun(id, n, 'mara', 'all clear', T0);
  assert.equal(stored(id, n).unchangedRuns, undefined, 'the first run had no run before it to repeat');
  tasks.recordRun(id, n, 'mara', '', T0 + 60 * MIN);
  assert.equal(stored(id, n).unchangedRuns, undefined, 'an empty note read as unchanged');
  // CONTROL: the empty note took "all clear" off lastRunNote, so the next "all clear" is a change, not a repeat.
  tasks.recordRun(id, n, 'mara', 'all clear', T0 + 120 * MIN);
  assert.equal(stored(id, n).unchangedRuns, undefined);
});

test('#5643: a late unchanged run is still marked late, and its row says both', () => {
  const { id, n } = freshRepeating();
  tasks.recordRun(id, n, 'mara', 'all clear', T0);
  tasks.recordRun(id, n, 'mara', 'all clear', T0 + 60 * MIN + 30 * MIN, { unchanged: true });   // half an hour off the hour
  const last = runs(id, n).pop();
  assert.equal(last.unchanged, true);
  assert.equal(last.late, true, 'fixture: this run should be late against an hourly rule on the hour');
});

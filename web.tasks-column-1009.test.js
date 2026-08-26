'use strict';

/**
 * kosmos#1009 (Josh, 2026-08-26): a project's Tasks column was blank on first
 * visit while the link under it read "View all tasks (3)".
 *
 * 🔑 THIS FILE EXTRACTS THE PREDICATE AND RUNS IT rather than matching its
 * text. A regex on the filter line proves the line was written; it cannot tell
 * you which tasks come out the other side, and "which tasks come out" IS the
 * bug. The same distinction cost a whole dead CSS rule a green run earlier
 * today.
 *
 *   node --test web.tasks-column-1009.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');

/* Lift the real predicate out of the shipped file, so this test cannot drift
   from what runs. Anchored on the assignment and bounded at its own line end,
   never a byte count. */
function columnPredicate() {
  const m = PAGE.match(/const column = all\.filter\((\(t\) => [^\n]+)\);/);
  assert.ok(m, 'the column filter moved or changed shape; re-anchor this test rather than deleting it');
  // eslint-disable-next-line no-new-func
  return new Function('return ' + m[1])();
}

const open_unassigned = { number: 1, progress: { assigned: 0, closed: false } };
const open_assigned   = { number: 2, progress: { assigned: 2, closed: false } };
const finished        = { number: 3, progress: { assigned: 1, closed: true } };
const no_progress_yet = { number: 4 };

test('an unassigned open task is IN the column -- this is the whole bug', () => {
  const keep = columnPredicate();
  assert.equal(keep(open_unassigned), true,
    'a task nobody has picked up is hidden again, so a new project shows an empty Tasks column on day one');
});

test('the column still shows assigned work, and still hides finished work', () => {
  const keep = columnPredicate();
  assert.equal(keep(open_assigned), true, 'assigned tasks fell out of the column');
  assert.equal(keep(finished), false, 'finished tasks came back into the column; the door is where they live');
});

/* A task the server has not yet computed progress for must not vanish. The
   OLD predicate led with `t.progress &&`, so a missing progress object was
   silently excluded -- the same shape as the bug, one field further out. */
test('a task with no progress object yet is open, not invisible', () => {
  const keep = columnPredicate();
  assert.equal(keep(no_progress_yet), true,
    'a task whose progress has not been computed disappears from the column instead of showing as open');
});

test('the door counts everything, so it can never disagree with an empty column', () => {
  assert.match(PAGE, /door\.textContent = 'View all tasks \(' \+ all\.length \+ '\)/,
    'the door no longer counts every task, so its number can disagree with what the column shows');
});

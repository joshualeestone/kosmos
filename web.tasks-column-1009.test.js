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

/* SUPERSEDED BY #1382, AND THIS FILE'S GOAL IS NOW MET BY CONSTRUCTION RATHER
   THAN BY ARITHMETIC. The assertion here used to pin `all.length` on the door,
   so that a door counting only OPEN work could not read (3) above a column
   showing nothing. The door now opens a screen spanning EVERY project, so a
   per-project number beside it could only ever disagree with its own
   destination (#1346), and it carries no count at all.
   => Two numbers cannot disagree if there is one. The claim this file made is a
   strict consequence of the stronger one, so the stronger one is what is
   asserted, and it is asserted HERE as well as in web.tasks-cap-1193.test.js
   because somebody reading #1009 must find out why its arithmetic went away
   rather than concluding the guard was dropped. The cross-project REASONING
   lives in that file with the rest of #1382's controls. */
test('the door carries no count, so it cannot disagree with the column at all', () => {
  assert.match(PAGE, /door\.textContent = 'View all tasks/, 'the door lost its label');
  assert.doesNotMatch(PAGE, /door\.textContent = 'View all tasks \(/,
    'a count is back on the door: it can disagree with this column again, and with the all-projects screen it opens');
});

/* CONTROL for the doesNotMatch above. A negative assertion whose pattern can
   never match is green forever and asserts nothing, so the pattern is run
   against the exact string it is meant to forbid, and must match it. */
test('control: the forbidden counted-door pattern can actually match', () => {
  const COUNTED_DOOR = "door.textContent = 'View all tasks (' + all.length + ') ';";
  assert.match(COUNTED_DOOR, /door\.textContent = 'View all tasks \(/,
    'the guard above cannot recognise a counted door, so its doesNotMatch proves nothing');
});

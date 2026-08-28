'use strict';
/**
 * kosmos#1193. Josh: "We should have a View All link for tasks and maybe we only
 * display the first N number. I'll let you decide what that is." Five.
 *
 * 🛑 THE CAP AND THE DOOR'S CONDITION ARE ONE CHANGE. The door was shown only
 * when `behind > 0`, where `behind` counts CLOSED tasks. Capping the column
 * without widening that test loses open tasks with NO control on screen to reach
 * them: eight open and none finished would render five and hide three silently.
 *
 * That is the case this suite exists for. It is not hypothetical: it is what the
 * obvious one-line version of this change does.
 *
 *   node --test web.tasks-cap-1193.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');

/* The rendering is inside a DOM painter, so the arithmetic is mirrored here from
   the source rather than driven. The assertions below pin BOTH the mirror and the
   source, so they cannot drift apart silently. */
const doorShows = (open, closed, cap = 5) => {
  const all = open + closed, column = open;
  const showing = Math.min(column, cap);
  return (all - column) + (column - showing) > 0;
};

test('a capped column still offers a way to the tasks it is hiding', () => {
  assert.equal(doorShows(8, 0), true, 'eight open and none finished: three are hidden and the door must show');
  assert.equal(doorShows(12, 4), true);
  assert.equal(doorShows(5, 2), true, 'finished tasks behind the door, as before the cap');
});

test('the door stays away when nothing is hidden', () => {
  assert.equal(doorShows(5, 0), false, 'exactly five open, nothing hidden, so no door');
  assert.equal(doorShows(3, 0), false);
});

test('the source computes the same thing the mirror above does', () => {
  assert.match(PAGE, /const TK_COLUMN_MAX = 5;/, 'the cap is gone or is no longer five');
  assert.match(PAGE, /column\.slice\(0, TK_COLUMN_MAX\)/, 'the column is no longer capped');
  assert.match(PAGE, /hiddenByCap = TK_SHOW_ALL \? 0 : column\.length - showing\.length/,
    'the count of tasks hidden BY THE CAP is gone');
  assert.match(PAGE, /\(behind \+ hiddenByCap\) > 0/,
    'the door test no longer counts tasks hidden by the cap, so a project with no finished tasks loses the ones past five');
});

test('the files link says View All, in Josh\'s newer words', () => {
  assert.match(PAGE, /'View All ' \+ body\.total : 'View All'/, 'the files link is not View All');
  assert.doesNotMatch(PAGE.replace(/\/\*[\s\S]*?\*\//g, ' '), /'Show all/,
    'a Show all label survives outside a comment');
});

test('CONTROL: the door test can return the dangerous answer', () => {
  const naive = (open, closed, cap = 5) => (open + closed - open) > 0;   // the pre-fix condition
  assert.equal(naive(8, 0), false, 'the OLD condition hides the door on eight open and none finished');
  assert.equal(doorShows(8, 0), true, 'and the new one does not, which is the whole change');
});

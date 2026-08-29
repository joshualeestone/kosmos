"use strict";
/**
 * #905: in the consolidated view's projects rail, a project name longer
 * than the rail's width was not truncated -- it rendered at its natural
 * width, centered, and escaped the column on both sides.
 *
 * Root cause: the rail reuses #pj-list's markup unchanged whatever
 * sub-layout (list, or the grid-of-tiles "asgrid") the person last left
 * the full projects panel on. #pj-list defaults to "asgrid", whose own
 * rules give .pj-row a centered, flex-column TILE treatment with
 * .pjcard-h dissolved to `display: contents` -- so .pjname became a bare
 * flex item with no bounded track to shrink into. The existing ellipsis
 * rule on the name (.pjcard-h b) was always correctly written; it never
 * had a box small enough to clip.
 *
 * First fix attempt (side-by-side name + pill, a real grid track) measured
 * wrong: a verbose pill ("No agents yet") still claimed most of the row
 * before the name's 1fr column got a turn, so even a SHORT name like "Book
 * Launch" truncated. Stacking the pill below the name instead gives the
 * name the full row width, which is the actual fix.
 *
 *   node --test web.consolidated-project-name-overflow.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');

test('the projects rail forces list-row layout regardless of the panel\'s stored asgrid/list sub-layout', () => {
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated #pj-list\.asgrid \{ display: flex; flex-direction: column; \}/,
    'the rail no longer neutralizes the tile-grid sub-layout, so a person who left the projects panel on asgrid gets tile rows in the narrow rail again');
});

/* 🛑 THE ASSERTION ABOVE WAS BLIND FOR AS LONG AS THE RULE EXISTED TWICE (#1459).
   The page carried it byte-identically at :2691 and :2809, inside the SAME
   `@media (min-width: 960px)` block, so either copy satisfied the `match` and
   EITHER COULD BE CORRUPTED WITHOUT THIS FILE NOTICING. Measured on the page
   before the duplicate was removed:

     corrupt :2809, the copy the cascade actually applies  ->  3 pass, 0 fail
     corrupt :2691, the copy it overrode                   ->  3 pass, 0 fail

   The first of those is the one that costs something: the rail genuinely breaks
   and the guard reports green. After the removal the same corruption fails, with
   the message above.

   ⚠️ RE-ANCHORING THE REGEX WOULD NOT HAVE FIXED IT, and that is why this is a
   count rather than a tighter pattern. However strict the pattern, a second copy
   still satisfies it. What was wrong was not what the assertion matched, it was
   that matching AT ALL cannot distinguish one copy from two.
   ⇒ So this asserts the POPULATION, which is the property the guard above needs
   in order to mean anything, and which no amount of pattern work can express. */
test('#1459: the rail rule exists exactly once, or the guard above cannot go red', () => {
  const RULE = 'html[data-layout="consolidated"] body.consolidated #pj-list.asgrid '
    + '{ display: flex; flex-direction: column; }';
  const n = PAGE.split(RULE).length - 1;
  assert.equal(n, 1,
    'the rail rule appears ' + n + ' times. At 0 the fix is gone; at 2 or more the '
    + 'assertion above is satisfied by a copy nobody edited, so a real regression in '
    + 'the winning copy passes silently, which is exactly #1459');
});

/* CONTROL for the count above. A population assertion is worthless if the string
   it counts can never be found, so this proves the same counting method reports
   the numbers that matter on inputs whose answers are known. Without it, a typo
   in RULE would make the test above assert 1 === 1 against nothing at all. */
test('control: the counting method can tell none from one from two', () => {
  const RULE = 'html[data-layout="consolidated"] body.consolidated #pj-list.asgrid '
    + '{ display: flex; flex-direction: column; }';
  const count = (hay) => hay.split(RULE).length - 1;
  assert.equal(count(''), 0, 'the counter cannot report absence');
  assert.equal(count(RULE), 1, 'the counter cannot report a single occurrence');
  assert.equal(count(RULE + '\n' + RULE), 2,
    'the counter cannot report a duplicate, so the test above could not have caught #1459');
});

test('the name and the status pill stack, rather than compete for one line', () => {
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated \.pj-row \.pjcard-h \{ display: flex; flex-direction: column; align-items: flex-start; gap: 2px; \}/,
    'the name/pill stacking is gone -- a verbose pill will squeeze even a short name again if they share a line');
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated \.pj-row \.pjname \{ order: 0; justify-content: flex-start; min-width: 0; width: 100%; \}/,
    'the name no longer takes the row\'s full width, so it has nothing to truncate against');
});

test('the existing ellipsis rule on the project name is untouched -- this fix gives it a box to work in, not a new rule', () => {
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated \.pjcard-h b \{ font-size: \.875rem; overflow-wrap: normal; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; \}/,
    'the pre-existing (and always correct) truncation rule on the name is gone');
});

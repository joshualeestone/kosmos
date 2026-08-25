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

'use strict';

/**
 * The TAB view's three columns, in the order Josh asked for.
 *
 * Josh, 2026-08-26 22:00: "in TAB view he wants Members top-left, Files beneath
 * it, Tasks far right." The markup already reads that way, so this file does not
 * change behaviour. It exists because nothing pinned the arrangement he named:
 * web.pjsplit-order-1017 pins Members-before-Files INSIDE the left column, and
 * the consolidated view has its own explicit grid rules, but which column is
 * which in the tab view rested on DOM order alone with no test on it.
 *
 * 🛑 AND THE TWO VIEWS DISAGREE ON PURPOSE (his reversal, 2026-08-26 22:05):
 *      tab view      Members, Files, then Tasks far right
 *      consolidated  Tasks, then Files, then Members
 * One DOM cannot satisfy both, so the consolidated view reorders in CSS. Anyone
 * who "fixes" the inconsistency by touching the markup breaks the view he
 * actually reported. This file pins the tab side; the consolidated side is
 * pinned by its own grid-row assertions in web.consolidated-*.
 *
 *   node --test web.tab-column-order.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

/* Bounded to the project page's own three-column pack, so a `.pjcol` anywhere
   else on the page cannot be read as one of these columns. */
function pj3() {
  const a = PAGE.indexOf('<div class="pj3">');
  assert.ok(a > -1, 'the three-column pack moved; re-anchor this test');
  return PAGE.slice(a, PAGE.indexOf('<div id="pj-one-view"', a + 1) > -1
    ? PAGE.indexOf('<div id="pj-one-view"', a + 1) : PAGE.length);
}

test('the tab view is three columns, not a stack', () => {
  /* Without this the order assertions below would still pass on a single-column
     layout, where "far right" means nothing. */
  assert.match(PAGE, /\.pj3 \{ display: grid; grid-template-columns: minmax\(0, 20%\) minmax\(0, 1fr\) minmax\(0, 20%\); /,
    'the tab view is no longer three columns, so "Members top left" and "Tasks far right" describe nothing');
});

test('Members and Files are the LEFT column, Tasks is the RIGHT one', () => {
  const seg = pj3();
  const split = seg.indexOf('<aside class="pjcol pjsplit">');
  const mid = seg.indexOf('<section class="pjcol pjmid">');
  const tasks = seg.indexOf('id="pj-tasks-field"');
  assert.ok(split > -1, 'the Members/Files column is gone from the pack');
  assert.ok(mid > -1, 'the conversation column is gone from the pack');
  assert.ok(tasks > -1, 'the tasks column is gone from the pack');
  /* 🔑 Anchored on the tasks FIELD rather than on its `<aside class="pjcol">`
     opener: that opener is not unique, and matching the first one would report
     the members column as the tasks column and still read as a pass. */
  assert.ok(split < mid && mid < tasks,
    'the tab view columns are out of order. Josh asked for Members and Files on the left, Tasks far right, and the tab view has no CSS reorder: DOM order IS the screen order here');
});

test('the consolidated view keeps its own opposite order', () => {
  /* The control on the control. If someone unifies the two views again, the
     assertion above stays green while the screen he reported goes back to
     wrong, so the disagreement itself has to be pinned. */
  assert.match(PAGE, /body\.consolidated \.pj3 > \.pjsplit > \.pjcard-members \{ grid-column: 2; grid-row: 3; \}/,
    'the consolidated view stopped placing Members last, so the two views have been unified again');
  assert.match(PAGE, /body\.consolidated \.pj3 > aside\.pjcol:not\(\.pjsplit\) \{ grid-column: 2; grid-row: 1; \}/,
    'the consolidated view stopped placing Tasks first');
});

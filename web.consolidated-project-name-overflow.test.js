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
const { effective } = require('./test-support/cascade');
const PAGE = fs.readFileSync('web/index.html', 'utf8');

/* 🛑 THESE ASSERT THE RULE THAT WINS, NOT THE ONE THAT READS FIRST (#1476).
   This file used to pin `.pjcard-h { display: flex; flex-direction: column; ... }`
   verbatim. A LATER rule for the same selector sets `display: contents`, so that
   pin was measurably inverted, both arms:

     delete the LATER rule  -> the layout actually changes -> pin stayed GREEN
     delete the EARLIER one -> no visual effect at all     -> pin went RED

   ⭐ And the docblock above already SAID `.pjcard-h` is dissolved to
   `display: contents`. The prose knew; the assertion did not. */
const ROW = 'html[data-layout="consolidated"] body.consolidated .pj-row';

/* #1430: the remaining brace-anchored assertions in this file no longer end at
   their rule's closing brace, so an appended declaration is not a red that looks
   like a product bug. That is how main went down at step 3 under #1310.

   ⚠️ TWO RESIDUALS remain for the text pins below. An open tail cannot see a
   SAME-RULE OVERRIDE, and it tolerates an APPEND but NOT a declaration INSERTED
   between the promised ones. #1310 happened to append; had it grouped the
   property differently this would not have prevented it.

   ✅ The THIRD residual, a same-selector later-rule override, was live in this
   file and is now FIXED above by #1476: those assertions resolve the cascade
   instead of pinning text, so no brace anchor applies to them at all.

   🛑 NOT MECHANICALLY ENFORCED (#1469). A guard was built and removed rather than
   shipped: it was blind to the very spelling that caused #1310, and a green
   nobody can trust stops the next person looking.

   Full argument and the four-arm proof: .claude/plans/css-brace-anchor-1430.md */

test('the projects rail forces list-row layout regardless of the panel\'s stored asgrid/list sub-layout', () => {
  /* 🛑 THE EFFECTIVE VALUE, NOT THE TEXT (#1476). This selector is declared TWICE
     in this scope with IDENTICAL declarations, so the text pin sat on the FIRST
     and the SECOND governs. Deleting the pinned rule changed nothing and turned
     this red; breaking the winning one left it green.

     ⚠️ AND THE SAME-VALUE CASE IS WHY IT WENT UNSEEN SO LONG. The #1476 guard
     flagged only when the WINNING VALUE DIFFERED, and here both say `flex` and
     `column`, so it stayed quiet on exactly the inversion it was written to
     catch (Vivienne, 2026-08-29, who found the same shape on .pj-row .pjcount).
     The guard now flags a later re-declaration regardless of value, which is
     what surfaced this line. */
  const RAIL = 'html[data-layout="consolidated"] body.consolidated #pj-list.asgrid';
  assert.equal(effective(PAGE, RAIL, 'display'), 'flex',
    'the rail no longer neutralizes the tile-grid sub-layout, so a person who left the projects panel on asgrid gets tile rows in the narrow rail again');
  assert.equal(effective(PAGE, RAIL, 'flex-direction'), 'column',
    'the rail stacks its rows horizontally, so the projects panel reads as a grid in a column that cannot hold one');

  /* ✅ AND SEPARATELY, THE DUPLICATE ITSELF IS PINNED (#1459). The two assertions
     above guard the BEHAVIOUR and are correct whichever copy wins. This one guards
     that the DUPLICATE STILL EXISTS, which is a different question: without it,
     #1459 could be closed by deleting a copy and nothing here would notice.
     📌 WHEN #1459 LANDS and a copy is removed, the effective() checks above stay
     green (behaviour unchanged, correctly) and THIS one reds. Change the 2 to a 1.
     That is the intended edit rather than a surprise; coupling it to the defect is
     deliberate, because an uncoupled version cannot fail.
     ⚠️ Limit, stated: an APPENDED declaration to one copy leaves the count at 2 and
     is invisible here. Control for the count itself: `#pj-composerhint
     { display: none; }` counts 1, so a 2 means something. */
  const DUP_RULE = /html\[data-layout="consolidated"\] body\.consolidated #pj-list\.asgrid \{ display: flex; flex-direction: column;/g;
  assert.equal((PAGE.match(DUP_RULE) || []).length, 2,
    'the duplicated #pj-list.asgrid rule (#1459) changed count: if a copy was removed, that is the fix landing and this 2 becomes a 1; if a copy had a declaration CHANGED or INSERTED, one of the two rails just diverged');
});

test('the name and the status pill stack, rather than compete for one line', () => {
  /* The stacking is produced by a GRID on the row, with the header dissolved so
     the name and pill become grid items of the row itself. Asserting the
     mechanism that governs, rather than a superseded flex rule that reads as if
     it does. */
  assert.equal(effective(PAGE, ROW, 'display'), 'grid',
    'the row is no longer a grid, so nothing places the name and pill on separate lines');
  assert.equal(effective(PAGE, ROW + ' .pjcard-h', 'display'), 'contents',
    'the header is no longer dissolved, so the name and pill are its children again and '
    + 'no rule on the row can place them independently');
  assert.equal(effective(PAGE, ROW + ' .pjname', 'grid-row'), '1',
    'the name left the first row');
  assert.equal(effective(PAGE, ROW + ' .pjpill', 'grid-row'), '2',
    'the name/pill stacking is gone -- a verbose pill will squeeze even a short name again if they share a line');
  assert.equal(effective(PAGE, ROW + ' .pjname', 'grid-column'), '1 / -1',
    'the name no longer spans the row, so it has nothing to truncate against');
  assert.equal(effective(PAGE, ROW + ' .pjname', 'min-width'), '0',
    'without min-width:0 a grid item refuses to shrink below its content, and the name cannot ellipsize');
});

test('the existing ellipsis rule on the project name is untouched -- this fix gives it a box to work in, not a new rule', () => {
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated \.pjcard-h b \{ font-size: \.875rem; overflow-wrap: normal; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/,
    'the pre-existing (and always correct) truncation rule on the name is gone');
});

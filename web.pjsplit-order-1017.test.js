'use strict';

/**
 * kosmos#1017: Files above Members, in the markup as well as on the screen.
 *
 * #980 achieved the visual order by swapping GRID ROWS and leaving the DOM
 * alone, so a sighted user read Files then Members while a keyboard user tabbed
 * Members then Files (WCAG 2.4.3 / 1.3.2). The markup now matches.
 *
 * 🛑 THE SECOND TEST IS THE ONE THAT MATTERS LONGER. The reason that swap was
 * dangerous rather than free is that fifteen rules identified these two cards by
 * POSITION -- `:first-child` meaning Members, `:last-child` meaning Files -- so
 * reordering them silently repointed the members scroller onto Files, the sticky
 * Files label onto Members, and `+ Add member` onto the files card. Nothing
 * throws and no text-matching test can see it. Banning the positional form is
 * what stops that being reloaded for the next person who reorders this region.
 *
 *   node --test web.pjsplit-order-1017.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');

/* #1430: the assertions below no longer end at their rule's closing brace, so an
   appended declaration is not a red that looks like a product bug. That is how
   main went down at step 3 under #1310.

   These promise a grid ROW and COLUMN rather than an absence, so a later
   `grid-row` in the same rule would override unseen.

   ⚠️ THREE THINGS IT DOES NOT COVER, and all three are real. An open tail cannot
   see a SAME-RULE OVERRIDE. It tolerates an APPEND but NOT a declaration INSERTED
   between the promised ones -- #1310 happened to append; had it grouped the
   property differently this would not have prevented it. And a SAME-SELECTOR,
   LATER-RULE override is invisible to any text pin, loosened or not: if the sheet
   declares the selector twice the later rule wins, and an assertion on the earlier
   one is GREEN when the behaviour breaks and RED on a no-op. Three instances were
   found in this tree and all three are now FIXED with cascade-resolving checks --
   two by #1476 itself, and a third here that #1476's guard could not see because
   both declarations carried the same VALUE.

   ⚠️ AND LOOSENING HAS A COST FOR THAT GUARD, DISCLOSED RATHER THAN LEFT TO BE
   FOUND: web.cascade-shadowed-pins-1476.test.js matches on a rule WITH its closing
   brace, so dropping the brace takes these files out of its reach. Measured: on
   main it sees 3 such assertions in the files this branch touches, on this branch
   it sees 0. Nothing fails today. The guard wants a brace-optional matcher, and
   that is #1469's territory rather than something to patch quietly here.

   🔑 So the four-arm proof behind this change establishes that each assertion
   tracks the rule TEXT. It does NOT establish that the rule GOVERNS.

   🛑 NOT MECHANICALLY ENFORCED (#1469). A guard was built and removed rather than
   shipped: it was blind to the very spelling that caused #1310, and a green
   nobody can trust stops the next person looking.

   Full argument, counts and the four-arm proof: .claude/plans/css-brace-anchor-1430.md */

/* Bounded at the aside's own close, and matched on the CARD DIVS rather than
   on the class names anywhere in the slice -- an earlier version of this check
   read the order out of a COMMENT that happens to mention both names, and
   reported the opposite of the truth. A string count is not a semantic fact. */
function cardOrder() {
  const a = PAGE.indexOf('<aside class="pjcol pjsplit">');
  assert.ok(a > -1, 'the split aside moved; re-anchor this test');
  const seg = PAGE.slice(a, PAGE.indexOf('</aside>', a));
  const f = seg.indexOf('<div class="pjcard pjcard-files">');
  const m = seg.indexOf('<div class="pjcard pjcard-members">');
  assert.ok(f > -1 && m > -1, 'one of the two named cards is gone from the split');
  return f < m ? ['files', 'members'] : ['members', 'files'];
}

/* 🛑 REVERSED BY JOSH ON 2026-08-26 22:05, item 3, and the premise of #1017 was
   mine and wrong. I unified the two views arguing that "two views of one project
   showing the same panels in opposite orders is itself a defect". He wants them
   different and he is the one who uses both:
     tab view      Members top left, Files under it, Tasks far right
     consolidated  Tasks, then Files, then Members
   ⚠️ SO THE WCAG TRADE IS BACK, KNOWINGLY. One DOM cannot match two opposite
   visual orders. The tab view now agrees with itself; the consolidated view has
   the eye reading Files then Members while the keyboard tabs Members then Files
   (2.4.3 / 1.3.2). That is a decision he made with both screens in front of him,
   not an oversight, and this test records it as one rather than silently
   dropping the assertion. */
test('the markup reads Members then Files, which the TAB view needs', () => {
  assert.deepEqual(cardOrder(), ['members', 'files'],
    'Files is first in the markup again, so the tab view shows Files above Members, which is the order Josh reported as wrong');
});

test('nothing selects the split cards by position', () => {
  /* 🔑 A FLOOR ON THE POPULATION, per Angel (2026-08-26 20:01): a check that
     COUNTS OCCURRENCES and asserts zero says "I looked and found none" and "I
     did not look" in the same words. Without this a renamed class, a broken
     read or a changed spelling finds nothing, reports clean, and the check
     quietly stops being a check. */
  const rules = (PAGE.match(/\.pjsplit/g) || []).length;
  assert.ok(rules >= 5,
    `only ${rules} .pjsplit references found. This low means the class was renamed and this scan is looking for something that no longer exists`);
  const bad = PAGE.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, l]) => /\.pjsplit[^{]*\.pjcard:(first|last)-child/.test(l));
  assert.deepEqual(bad, [],
    'a rule identifies these cards by position again; reorder them and it silently repoints:\n'
      + bad.map(([n, l]) => '  ' + n + ': ' + l.trim()).join('\n'));
});

/* The grid rows must still put Files above Members, or the markup fix would
   have "aligned" the two orders by moving the VISUAL one to the wrong place. */
test('the consolidated rows still paint Files above Members', () => {
  assert.match(PAGE, /\.pjsplit > \.pjcard-files \{ grid-column: 2; grid-row: 2;/,
    'the files card left row 2, so Josh\'s Files-above-Members order is gone');
  assert.match(PAGE, /\.pjsplit > \.pjcard-members \{ grid-column: 2; grid-row: 3;/,
    'the members card left row 3');
});

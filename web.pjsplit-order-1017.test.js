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

test('the markup reads Files then Members, so tab order matches the eye', () => {
  assert.deepEqual(cardOrder(), ['files', 'members'],
    'Members is first in the markup again, so a keyboard user tabs Members then Files while the screen shows Files then Members');
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
  assert.match(PAGE, /\.pjsplit > \.pjcard-files \{ grid-column: 2; grid-row: 2; \}/,
    'the files card left row 2, so Josh\'s Files-above-Members order is gone');
  assert.match(PAGE, /\.pjsplit > \.pjcard-members \{ grid-column: 2; grid-row: 3; \}/,
    'the members card left row 3');
});

'use strict';
/**
 * kosmos#1303 group B: the rules and the white box.
 *
 * ⚠️ SOURCE PINS. The verification was a browser probe against a sandboxed
 * board with a project open; every number in these comments was measured there,
 * before and after. These exist so the values cannot drift back silently.
 *
 *   node --test web.rules-boxes-1303b.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');
const rule = (needle) => {
  const n = PAGE.split(needle).length - 1;
  assert.equal(n, 1, `the anchor ${needle} matches ${n} places, so this would read whichever came first`);
  return PAGE.slice(PAGE.indexOf(needle), PAGE.indexOf('}', PAGE.indexOf(needle)) + 1);
};

test('item 3: the Files label is the column tone, not a white box (#3218: header cell)', () => {
  /* #1303 B was "Files in this project have a big white box behind them that needs to go away" --
     the fix kept the label showing the column ground (--k-side) rather than a white patch. #3218
     made Files a header grid, so the label is a fixed header cell now (no card-as-scroller, no
     sticky). `background: none` keeps the ground showing through, which is the same outcome by
     transparency; the label must never paint its own (white) background. */
  const r = rule('.pjcard-files > .dlab { grid-column: 1');
  assert.match(r, /background: none/, 'the Files label paints its own background again (a box), instead of showing the column ground through');
  assert.doesNotMatch(r, /background: var\(--k-surface/, 'the Files label is white again');
});

test('item 1: the head rule reaches the column edges', () => {
  // MEASURED: .pjmid 442.1..1184, .pjmidhead 458.1..1167 -> inset 16 left, 17
  // right. After: 0 and 1, the 1 being .pjmid's own border-right.
  const r = rule('body.consolidated .pjmidhead { align-items: center');
  assert.match(r, /margin: 0 -16px 12px/, 'the head no longer reaches the column edges');
  assert.match(r, /padding: 0 16px 10px/, 'the padding that keeps the content in place is gone');
});

test('item 4: the horizontal rule divides Tasks and Files, carried by Files (#3218)', () => {
  /* #3218 hid the Members card, so the rule that used to sit between Files and Members is gone.
     The one horizontal rule in the right column now divides Tasks (row 1) and Files (row 2),
     carried by the Files card's border-top (via `.pjcard + .pjcard` and `.pjcard-files`). */
  assert.match(PAGE, /\.pj3 > \.pjsplit > \.pjcard-files \{\n\s*border-top: 1px solid var\(--k-rule\)/,
    'the Tasks/Files divider (Files border-top) is gone');
  assert.doesNotMatch(PAGE, /\.pj3 > \.pjsplit > \.pjcard-members \{\n\s*border-top: 1px solid var\(--k-rule\)/,
    'the old members border-top is back, but the Members card is hidden now -- it would draw a rule under nothing');
});

test('item 2: the cards fill their track, so their rules reach the edges', () => {
  /* MEASURED: the right track is 240px and the cards rendered 216 wide, because
     `.pjcard` carries `margin: 0 12px 12px`. After: 240. */
  // #3218: the edge margin/padding rule is Files-only now (the .pjcard-members half was dead once
  // the Members card became display:none in the consolidated view).
  const r = rule('.pjcard-files {\n    margin-left: 0; margin-right: 0');
  assert.match(r, /padding-left: 12px; padding-right: 12px/,
    'the margin was removed without giving the padding back, so the content moved');
});

test('the edge override sits AFTER the margin rule it overrides', () => {
  /* ⚠️ THIS IS WHY IT WORKS AND IT IS NOT CosmETIC. My first version was ~100
     lines earlier with identical specificity, so `margin: 0 12px 12px` won on
     source order alone. The probe showed the padding applied and the margin
     unchanged, which is what a lost tie looks like. */
  const marginAt = PAGE.indexOf('margin: 0 12px 12px; }');
  const overrideAt = PAGE.indexOf('margin-left: 0; margin-right: 0; padding-left: 12px');
  assert.ok(marginAt > -1 && overrideAt > -1, 'one of the two rules is gone');
  assert.ok(overrideAt > marginAt,
    'the edge override moved above the margin rule again, so it silently loses the tie');
});

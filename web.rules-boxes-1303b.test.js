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

test('item 3: the Files label is the column tone, not white', () => {
  /* MEASURED: --k-surface is #ffffff and --k-side is #f3f1ec, and .pj3 (the
     ground) is --k-side. So the sticky label was a white patch on a stone
     column, which is exactly the phrase Josh used. */
  const r = rule('.pjcard-files > .dlab { position: sticky');
  assert.match(r, /background: var\(--k-side/, 'the Files label is painted white again');
  assert.doesNotMatch(r, /background: var\(--k-surface/);
  // The background itself must STAY: it is the ground scrolled rows slide under.
  assert.match(r, /position: sticky/);
});

test('item 1: the head rule reaches the column edges', () => {
  // MEASURED: .pjmid 442.1..1184, .pjmidhead 458.1..1167 -> inset 16 left, 17
  // right. After: 0 and 1, the 1 being .pjmid's own border-right.
  const r = rule('body.consolidated .pjmidhead { align-items: center');
  assert.match(r, /margin: 0 -16px 12px/, 'the head no longer reaches the column edges');
  assert.match(r, /padding: 0 16px 10px/, 'the padding that keeps the content in place is gone');
});

test('item 4: Members carries the rule, and the reason is the DOM order', () => {
  /* 🛑 MEASURED DOM: .pjsplit's children are [members, files] -- the OPPOSITE of
     the visual order. So `.pjcard + .pjcard` matches FILES and drew above the
     top card instead of between the two. */
  assert.match(PAGE, /\.pj3 > \.pjsplit > \.pjcard-members \{\n\s*border-top: 1px solid var\(--k-rule\)/,
    'the Members rule is gone, so there is nothing between Files and Members again');
});

test('item 2: the cards fill their track, so their rules reach the edges', () => {
  /* MEASURED: the right track is 240px and the cards rendered 216 wide, because
     `.pjcard` carries `margin: 0 12px 12px`. After: 240. */
  const r = rule('.pjcard-members {\n    margin-left: 0; margin-right: 0');
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

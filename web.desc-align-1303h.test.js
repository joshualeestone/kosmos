'use strict';
/**
 * kosmos#1303 H item 5: the expanded description lines up with the title.
 *
 * Josh: "When I expand the title and description area, the formatting is really
 * wonky. Let's flush the left description with the title and put a little bit of
 * space in between the title and the description."
 *
 * MEASURED, expanded, 1440 wide:
 *     arrow left 458.1 · title text 473.6 · description 458.1  <- flush with the ARROW
 * After: title text 480.1 · description text 480.1.
 *
 *   node --test web.desc-align-1303h.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');
const rule = (needle) => {
  const n = PAGE.split(needle).length - 1;
  assert.equal(n, 1, `the anchor ${needle} matches ${n} places`);
  return PAGE.slice(PAGE.indexOf(needle), PAGE.indexOf('}', PAGE.indexOf(needle)) + 1);
};

test('the indent is DERIVED from the arrow and the row gap, not a magic number', () => {
  /* 15.5px was the measured overhang, and writing it in would have stopped being
     right the first time the glyph changed size. The arrow gets an explicit
     width so there is something to derive from. */
  assert.match(rule('.pjtitle { --pjdisc-w:'), /--pjdisc-w: 1rem/);
  assert.match(rule('.pjdisc { width:'), /var\(--pjdisc-w\)/,
    'the arrow no longer takes its width from the shared variable');
  assert.match(rule('.pjtitle.is-open #pj-one-desc {'), /padding-left: calc\(var\(--pjdisc-w\) \+ 6px\)/,
    'the description indent is gone or hardcoded');
});

test('a little space between the two lines', () => {
  assert.match(rule('body.consolidated .pjmidhead .pjtitle {'), /gap: 5px/,
    'the title and description are back to touching at 1px');
});

test('the expander still un-clamps, which is what it was built for', () => {
  /* #1005's own finding: the disclosure opened onto the SAME truncated line. A
     change to this rule must not quietly drop that. */
  const r = rule('.pjtitle.is-open #pj-one-desc {');
  assert.match(r, /white-space: normal/);
  assert.match(r, /overflow: visible/);
  assert.match(r, /max-width: var\(--k-measure/);
});

test('the collapsed state is untouched', () => {
  assert.match(PAGE, /\.pjtitle:not\(\.is-open\) #pj-one-desc \{ display: none; \}/,
    'the closed state changed, and the button claims the content is not present');
});

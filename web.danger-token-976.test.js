'use strict';

/**
 * kosmos#976: the sign-in-first step is a marked warning, and `--danger` exists.
 *
 * 🛑 THE TOKEN WAS NEVER DEFINED. Two controls already painted themselves
 * `var(--danger, #b3261e)` and nothing declared it, so both had always fallen
 * back. That reads fine in light (6.54:1) and FAILS in dark: #b3261e is 2.69:1
 * on the dark card, under the 4.5 a text colour needs. Adding a third red
 * without fixing that would have added a third illegible control.
 *
 * This is the `--k-sunk` defect again, which this codebase already records: a
 * borrowed token needs its DEFINITION, not just the fallback its source
 * happened to carry. A fallback hides a missing token in whichever theme it
 * happens to suit.
 *
 *   node --test web.danger-token-976.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');

function lum(hex) {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
function token(name, after) {
  const from = after ? PAGE.indexOf(after) : 0;
  const m = PAGE.slice(from).match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})'));
  assert.ok(m, '--' + name + ' is not defined' + (after ? ' in the dark block' : ''));
  return m[1];
}

test('--danger is DEFINED, in both themes, not left to a fallback', () => {
  const light = token('danger');
  const dark = token('danger', '@media (prefers-color-scheme: dark) {');
  assert.notEqual(light.toLowerCase(), dark.toLowerCase(),
    'one value serves both themes; the light red is 2.69:1 on a dark card, so one theme is failing');
});

test('the danger red is legible on every ground it lands on', () => {
  const light = token('danger');
  for (const [n, g] of [['card', '#ffffff'], ['page', '#faf9f7'], ['side', '#f3f1ec']]) {
    assert.ok(ratio(light, g) >= 4.5, `danger is ${ratio(light, g).toFixed(2)}:1 on the ${n} (needs 4.5)`);
  }
  const dark = token('danger', '@media (prefers-color-scheme: dark) {');
  for (const [n, g] of [['card', '#17191c'], ['page', '#0c0d0f'], ['elevated', '#2c2c2e']]) {
    assert.ok(ratio(dark, g) >= 4.5, `danger is ${ratio(dark, g).toFixed(2)}:1 on the dark ${n} (needs 4.5)`);
  }
});

/* ⚠️ THE CONTROL: the value the fallback used must still fail in dark, or this
   test is agreeing with itself rather than measuring the defect it was written
   for. */
test('the control: the old fallback red would still fail in dark', () => {
  const r = ratio('#b3261e', '#17191c');
  assert.ok(r < 4.5,
    `#b3261e now measures ${r.toFixed(2)}:1 on a dark card, so this control no longer tests anything -- re-derive it rather than deleting it`);
});

/* Colour must not be the only carrier: the glyph is decoration and the words
   do the work, or the warning says nothing to a screen reader -- who can skip
   the step just as easily. */
test('the warning is carried by words, not only by the red', () => {
  assert.match(PAGE, /<span class="dwarn-m" aria-hidden="true">/,
    'the warning glyph is announced; it is decoration and should be aria-hidden');
  assert.match(PAGE, /<b>First, sign in to the other Claude account in your browser\.<\/b>/,
    'the step is no longer stated imperatively in the text, so only the colour marks it as required');
  assert.match(PAGE, /\.dwarn \{[^}]*color: var\(--k-ink\)/,
    'the warning line is muted again, which is what made it read as optional advice');
});

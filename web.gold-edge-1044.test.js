'use strict';

/**
 * kosmos#1044: the edge of a gold primary button is a contrast floor.
 *
 * `.uprime` painted its border the same colour as its fill, so the control's
 * whole visual boundary measured 1.95:1 against a white card -- under the 3:1
 * WCAG SC 1.4.11 asks of anything that identifies a control. The TEXT was never
 * the problem (ink on gold is 9.31:1); the button itself was what disappeared,
 * on the primary action of nearly every screen that decides something.
 *
 * 🔑 THIS COMPUTES FROM THE REAL TOKEN BLOCKS rather than matching a sentence.
 * A comment can assert a ratio; only arithmetic on the actual hex can hold it.
 * The same shape as the open-project marker pin in web.consolidated-980.
 *
 *   node --test web.gold-edge-1044.test.js
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
function ratio(a, b) {
  const x = lum(a); const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/* Read a token out of a NAMED block, so the light and dark values cannot be
   confused for each other -- the failure this whole card is about is a colour
   read against the wrong ground. */
function token(name, after) {
  const from = after ? PAGE.indexOf(after) : 0;
  assert.ok(from > -1, 'block anchor missing: ' + after);
  const m = PAGE.slice(from).match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})'));
  assert.ok(m, 'token --' + name + ' not found after ' + (after || 'start'));
  return m[1];
}

const LIGHT_EDGE = token('gold-edge');
const DARK_EDGE = token('gold-edge', '@media (prefers-color-scheme: dark) {');
const FILL = token('gold-bright');

test('the gold edge clears 3:1 on every LIGHT ground it sits on', () => {
  for (const [name, ground] of [['card', '#ffffff'], ['page', '#faf9f7'], ['side', '#f3f1ec']]) {
    const r = ratio(LIGHT_EDGE, ground);
    assert.ok(r >= 3, `the gold button's edge measures ${r.toFixed(2)}:1 on the ${name} ground (needs 3:1), so the control has no visible boundary there`);
  }
});

test('the gold edge clears 3:1 on every DARK ground it sits on', () => {
  for (const [name, ground] of [['card', '#17191c'], ['page', '#0c0d0f'], ['side', '#111316']]) {
    const r = ratio(DARK_EDGE, ground);
    assert.ok(r >= 3, `the gold button's edge measures ${r.toFixed(2)}:1 on the dark ${name} ground (needs 3:1)`);
  }
});

/* ⚠️ THE INVERTING CONTROL. Without it these pass on any dark-enough colour and
   would keep passing if someone "simplified" the edge back to the fill. This
   asserts the OLD value still fails, so the test is measuring the thing that
   was broken rather than agreeing with itself. */
test('the control: the fill colour would still fail as an edge', () => {
  const r = ratio(FILL, '#ffffff');
  assert.ok(r < 3,
    `--gold-bright now measures ${r.toFixed(2)}:1 on a white card. Either the brand gold changed, or this control is no longer testing anything -- re-derive it rather than deleting it.`);
});

test('the edge is a token, not a literal, and both themes define it', () => {
  assert.match(PAGE, /border-color: var\(--gold-edge\)/,
    'the uprime border went back to a literal, so the two themes cannot differ and one of them fails');
  assert.notEqual(LIGHT_EDGE.toLowerCase(), DARK_EDGE.toLowerCase(),
    'light and dark share one edge colour; no single value clears 3:1 on both, so one theme is failing');
});

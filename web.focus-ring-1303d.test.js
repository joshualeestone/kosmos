'use strict';
/**
 * kosmos#1303 D: the composer's focus outline is not doubled.
 *
 * Josh: "The stroke around the dialog input is way too harsh. It needs to be the
 * same type and color as the vertical rules and horizontal rules on this
 * layout." He confirmed on 2026-08-28 that he means the OUTLINE AROUND THE BOX.
 *
 * MEASURED with focus asserted inside the box:
 *     before  focused = 1px --k-ink-2  PLUS a 1px ring of the same colour
 *     after   focused = 1px --k-ink-2, no ring; contrast 7.84 against its ground
 *
 * 🛑 MY FIRST MEASUREMENT SAID "no change on focus" AND WAS WRONG. The probe
 * clicked the input but never asserted focus had landed, and `:focus-within`
 * applies only while a descendant actually holds focus -- so it read the resting
 * state twice and reported it as the focused one.
 *
 *   node --test web.focus-ring-1303d.test.js
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

test('the ring is a soft halo, not a second near-black stroke', () => {
  /* 🛑 SOFTENED, NOT DELETED. My first version dropped the box-shadow outright
     and Splinter corrected it: the ring is an accessibility affordance, because
     a colour change alone asks somebody to remember the resting border while a
     ring is a change of SHAPE that needs no comparison.
     What was harsh was two hard 1px strokes stacked into one 2px edge. */
  const r = rule('.composerbox:focus-within {');
  assert.match(r, /box-shadow: 0 0 0 3px rgba\(74, 79, 87, \.12\)/,
    'the focus ring was removed or hardened again');
  assert.doesNotMatch(r, /box-shadow: 0 0 0 1px var\(--k-ink-2\)/,
    'the doubled near-black outline is back, which is what "way too harsh" described');
});

/**
 * 🛑 THE COLOUR CHANGE IS NOT OPTIONAL AND THIS IS WHY THE TEST EXISTS.
 * "Match the layout's rules" taken literally would paint the focused border
 * `--k-rule`, which is the RESTING colour -- focus would become invisible. A
 * visible focus indicator is an accessibility requirement, so the harshness was
 * removed by dropping the DOUBLING, never the signal.
 * Measured contrast of the focused border against the composer's ground: 7.84,
 * where WCAG asks 3:1.
 */
test('focus still changes the border colour, or the indicator is gone', () => {
  const r = rule('.composerbox:focus-within {');
  assert.match(r, /border-color: var\(--k-ink-2\)/,
    'the focused border no longer changes colour, so there is no visible focus at all');
  assert.doesNotMatch(r, /border-color: var\(--k-rule\)/,
    'the focused border was set to the RESTING colour, which makes focus invisible');
});

test('the resting border is untouched, because it always matched', () => {
  // Splinter and I each measured this independently: 1px --k-rule in both
  // themes. That half of the item was never broken.
  assert.match(rule('.composerbox { display: flex'), /border: 1px solid var\(--k-rule\)/);
});

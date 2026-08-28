'use strict';
/**
 * kosmos#1303 group A, the consolidated view's vertical rhythm.
 *
 * ⚠️ THESE ARE SOURCE PINS, AND THE REAL VERIFICATION WAS A BROWSER PROBE.
 * Every number below was measured in a real Chromium against a sandboxed board
 * with a three-agent fixture, before and after. These assertions exist so the
 * values cannot drift back silently; they are not the evidence.
 *
 *   node --test web.rhythm-1303a.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');
/**
 * The declaration block for a selector, sliced to the closing brace.
 *
 * ⚠️ IT ASSERTS THE NEEDLE IS UNIQUE, and that is not defensive tidiness: my
 * first version used `indexOf` on `body.consolidated > #rail-agents {`, which
 * appears TWICE -- once for grid placement at ~2196 and once for the background
 * and padding at ~2359. It sliced the wrong rule and two assertions failed
 * against a block that never had the properties they were about.
 * Same trap as a perturbation landing on the wrong site: an ambiguous anchor
 * does not error, it quietly measures something else.
 */
const rule = (needle) => {
  const n = PAGE.split(needle).length - 1;
  assert.equal(n, 1, `the anchor ${needle} matches ${n} places, so this would read whichever came first`);
  const at = PAGE.indexOf(needle);
  return PAGE.slice(at, PAGE.indexOf('}', at) + 1);
};

test('item 1: the grey band is gone, because the header margin is zeroed', () => {
  /* MEASURED: `.apphead` rendered 4px tall in this view with every child hidden.
     The header inside it is 0px high and carried `margin-bottom`, and the rule
     zeroed padding and min-height and left the margin. After: 0px, and every
     column head moved up exactly 4px (49 -> 45). */
  const r = rule('body.consolidated > .apphead header {');
  assert.match(r, /margin:\s*0/, 'the header margin is back, so the band is back');
});

test('item 4: the agent status is not bold', () => {
  // MEASURED at font-weight 600 before: the base .lstate sets 600 and the
  // consolidated override changed only the size.
  assert.match(rule('body.consolidated .lrow > .lstate {'), /font-weight:\s*400/);
});

test('item 5: the agents sit closer together', () => {
  // MEASURED: 6px between consecutive rows before, 4px after.
  assert.match(rule('#alist { grid-column: 1; grid-row: 40'), /gap:\s*4px/);
});

/**
 * 🛑 ITEMS 6 AND 7 NEED TWO DIFFERENT MECHANISMS FOR ONE NUMBER, and that is the
 * finding rather than an implementation detail.
 *
 * `#rail-agents` is a SIBLING of `#alist`. `#rail-projects` is the FIRST CHILD of
 * `#pj-list-view`. So padding on the projects container moves the projects
 * LABEL, not its rows: measured, the heads went from both-45 to 45 and 49.
 *
 * And the shared `.railhead` margin reaches projects but NOT agents, because
 * `#rail-agents` carries an id-level `margin: 0` that outbids it.
 */
test('items 6 and 7: 4px above the first row in BOTH columns, by the two routes', () => {
  assert.match(rule('body.consolidated > #alist#alist {'), /padding-top:\s*4px/,
    'the agents list lost its room above the first row');
  assert.match(rule('body.consolidated .railhead {'), /margin:\s*0 2px 4px 6px/,
    'the projects label lost its room below it');
});

test('the agents rail keeps margin 0, or the projects-only rule stops being projects-only', () => {
  /* This is what makes the pair above correct. If somebody "tidies" this margin
     away, the .railhead rule starts reaching the agents rail too and the room
     doubles on one side only. */
  assert.match(rule('#rail-agents { background: var(--k-side, #f3f1ec)'), /margin:\s*0/);
});

test('the two heads are not given different heights', () => {
  /* ⚠️ MY OWN REGRESSION, CAUGHT BY THE PROBE. I first put item 6's 4px on
     `#rail-agents` as padding. It worked, and it made that head 32px against the
     projects head's 28, so the two labels stopped sharing a baseline -- item 2 of
     this same group, broken by the fix for item 6. Nothing in the source hinted
     at it; only measuring both did. */
  assert.match(rule('#rail-agents { background: var(--k-side, #f3f1ec)'), /padding:\s*8px 8px 0/,
    'the agents head has bottom padding again, which pushes its label off the projects baseline');
});

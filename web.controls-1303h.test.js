'use strict';
/**
 * kosmos#1303 group H, items 1 and 2. Verified in a browser; these pin the values.
 *
 *   node --test web.controls-1303h.test.js
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

test('item 1: the Tasks plus takes the first grid track, so it sits left of the label', () => {
  // MEASURED: plus left 1212, label left 1242. Before, the grid was `1fr auto`
  // and the button sat at the far right reading "+ New task".
  assert.match(rule('#pj-tasks-field { grid-template-columns:'), /auto minmax\(0, 1fr\)/,
    'the tracks are back to label-then-button, so the plus returns to the right');
  assert.match(rule('#pj-tasks-field > #pj-newtask {'), /grid-column: 1/);
  assert.match(rule('#pj-tasks-field > .dlab { grid-column: 2'), /grid-column: 2/);
});

test('item 1: it is the rails\' 22x22 glyph, not a worded button', () => {
  const r = rule('#pj-tasks-field > #pj-newtask {');
  assert.match(r, /width: 22px; height: 22px/, 'the rails draw 22x22 and this no longer matches them');
  assert.match(r, /font-size: 0/, 'the " New task" words are drawn again');
  assert.match(rule('#pj-tasks-field > #pj-newtask > span {'), /font-size: 15px/,
    'the + glyph lost its own size, so the button is now invisible rather than compact');
});

/**
 * 🛑 THE ACCESSIBLE NAME IS THE REASON FOR `font-size: 0` RATHER THAN
 * `display: none` ON THE TEXT. The button's name comes from its text content, so
 * hiding the text with `display: none` would take the name with it and leave a
 * control announced as "+". MEASURED in the browser: textContent is still
 * "+ New task" after the change.
 */
test('item 1: the words are still in the DOM, so the button keeps its name', () => {
  assert.match(PAGE, /<button class="btn" id="pj-newtask" type="button"><span aria-hidden="true">\+<\/span> New task<\/button>/,
    'the New task words were deleted from the markup, which removes the accessible name');
});

test('item 2: a folded section hides its plus, and only its plus', () => {
  /* Josh, 10:23. Folded, the rail is 48px and the label is gone, so a + is an
     action with nothing visible to act on. MEASURED: unfolded both visible,
     folded both hidden, and the fold arrow still visible either way. */
  const r = rule('body.consolidated.fold-a #rail-agents-new,');
  assert.match(r, /#rail-projects-new \{ display: none/);
  // The control: the arrow that unfolds it must NOT be caught by the same rule.
  assert.doesNotMatch(r, /rail-agents-fold|rail-projects-fold/,
    'the fold arrow is hidden too, which would make a folded rail impossible to reopen');
});

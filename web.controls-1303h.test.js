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

test('#3304: the Tasks header reads label, then View All, then the plus on the far right', () => {
  /* #3304 (Josh 2026-09-19) reversed the earlier "+ | TASKS | View All" order. Now:
     TASKS flush-left on the 1fr track, View All next, and the + on the far-right track.
     (Before #3304 the plus took grid-column 1 in an `auto minmax(0,1fr) auto` grid; this
     test pinned that and is updated here to Josh's newer order.) */
  assert.match(rule('body.consolidated .pj3 #pj-tasks-field { grid-template-columns:'), /minmax\(0, 1fr\) auto auto/,
    'the Tasks header tracks are not label(1fr) | View All | +');
  assert.match(rule('body.consolidated .pj3 #pj-tasks-field > #pj-newtask {'), /grid-column: 3/,
    'the Tasks + is not on the far-right track');
  assert.match(rule('.pj3 #pj-tasks-field > .dlab {'), /grid-column: 1/,
    'the Tasks label is not flush-left on the first track');
  assert.match(rule('body.consolidated .pj3 #pj-tasks-field > #pj-alltasks {'), /grid-column: 2/,
    'View All is not in the middle track, to the left of the +');
});

test('#3756: the tab view\'s Tasks header is the same label | View All | + row', () => {
  /* Josh, 0.6.94: "make tasks and files work just like they do on the consolidated view". The
     anchors above are prefixed with the consolidated scope since #3756 gave the tab view its own
     copies of these rules; these pin the tab view's. render-consolidated-layouts.js compares the two
     rendered headers. */
  assert.match(rule('body:not(.consolidated) .pj3 #pj-tasks-field { grid-template-columns:'), /minmax\(0, 1fr\) auto auto/,
    'the tab view\'s Tasks header tracks are not label(1fr) | View All | +');
  assert.match(rule('body:not(.consolidated) .pj3 #pj-tasks-field > #pj-newtask {'), /grid-column: 3/, 'the tab view\'s + is not on the far-right track');
  const va = rule('body:not(.consolidated) .pj3 #pj-tasks-field > #pj-alltasks, ');
  assert.match(va, /grid-column: 2; grid-row: 1/, 'the tab view\'s View All is not beside the title');
  assert.match(va, /font-size: var\(--consolidated-link-size\)/, 'the tab view\'s View All is not the consolidated small size');
});

test('item 1: it is the rails\' 22x22 glyph, not a worded button', () => {
  const r = rule('body.consolidated .pj3 #pj-tasks-field > #pj-newtask {');
  assert.match(r, /width: 22px; height: 22px/, 'the rails draw 22x22 and this no longer matches them');
  assert.match(r, /font-size: 0/, 'the " New task" words are drawn again');
  assert.match(rule('.pj3 #pj-tasks-field > #pj-newtask > span {'), /font-size: 15px/,
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

// #2711 item 10: the tab view now applies the SAME font-size:0 "+"-only
// treatment to #pj-add-member (both layouts share the technique). Guard its
// worded name too, so a future edit that swaps the "+ Add member" text for a
// bare glyph is caught, exactly as the #pj-newtask test above catches it.
test('#2711 item 10: the Add member button keeps its worded name in the DOM', () => {
  assert.match(PAGE, /<button class="btn-quiet pj-addmem" id="pj-add-member" type="button"><span aria-hidden="true">\+<\/span> Add member<\/button>/,
    'the Add member words were deleted from the markup, which removes the accessible name (font-size:0 hides them visibly, so the text must stay)');
});

test('item 2: a folded section hides its plus, and only its plus', () => {
  /* Josh, 10:23. Folded, the rail is 48px and the label is gone, so a + is an
     action with nothing visible to act on. MEASURED: unfolded both visible,
     folded both hidden, and the fold arrow still visible either way.
     #3126 (Josh, 6.68): only the agents column folds now - the projects column is
     no longer collapsible, so this is the agents-only fold rule (was a shared
     rule that also hid #rail-projects-new). */
  const r = rule('body.consolidated.fold-a #rail-agents-new');
  assert.match(r, /#rail-agents-new \{ display: none/);
  // The control: the arrow that unfolds it must NOT be caught by the same rule.
  assert.doesNotMatch(r, /rail-agents-fold/,
    'the fold arrow is hidden too, which would make a folded rail impossible to reopen');
});

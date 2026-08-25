"use strict";
/**
 * #774 (Josh, 2026-08-24 22:34): switching to the consolidated view rendered
 * differently depending on what the Agents page was last left on. The org
 * chart painted full-width over the rails, and an empty centre with both
 * rails folded read as a dead end ("I have no way to get back").
 *
 *   node --test web.consolidated-774.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');
const body = PAGE.replace(/<!--[\s\S]*?-->/g, '');

test('the org chart never paints while the consolidated view is up; the rail is always the list', () => {
  assert.match(PAGE, /const show = onAgents && BOARD_LAYOUT === 'org' && !document\.body\.classList\.contains\('consolidated'\);/);
  assert.match(PAGE, /const lay = document\.body\.classList\.contains\('consolidated'\) \? 'list' : BOARD_LAYOUT;/);
});

test('an empty consolidated centre says what to press, and says it differently when the projects rail is folded', () => {
  assert.match(body, /<p class="fhint" id="pj-none" hidden><\/p>\s*<div id="pj-list-view">/);
  assert.match(PAGE, /function paintPjNone\(which\) \{/);
  assert.match(PAGE, /'Nothing is open yet\. Pick a project on the left, or press \+ above the project list to start one\.'/);
  assert.match(PAGE, /const col = cls\.contains\('fold-a'\) \? 'second narrow column' : 'narrow column';/, 'both rails folded: the sentence says which narrow column');
  assert.match(PAGE, /\? 'No projects yet\. Press \+ at the top of the ' \+ col \+ ' to start one\.'/, 'folded and empty: press +, no need to open the column first');
  assert.match(PAGE, /: 'Nothing is open yet\. The projects list is folded; press \\u203a at the top of the ' \+ col \+ ' to open it\.'/);
  // the open rail's own "No projects yet" card says it; the sentence stays out of its way
  assert.match(PAGE, /\} else if \(empty\) \{\n(?:[^\n]*\n){1,4}    say = '';/);
  // the view is the record, never the DOM (the list stays visible beside the New project form in the consolidated layout)
  assert.match(PAGE, /const view = which === undefined \? PJ_VIEW : which;\n  const show = document\.body\.classList\.contains\('consolidated'\) && view === 'list';/);
  // "No projects yet" only after a read has happened
  assert.match(PAGE, /const empty = PJ_LOADED_ONCE && !PJ_READ_FAILED && PROJECTS\.length === 0;/, 'a failed read never reads as "no projects"');
  assert.match(PAGE, /PJ_READ_FAILED = true;\n    paintPjNone\(\);/, 'the failure branch repaints the sentence');
  // painted after the read's outcome is recorded (PJ_READ_FAILED = false), never between the two
  assert.match(PAGE, /PJ_READ_FAILED = false;\n(?:[^\n]*\n){0,4}    paintPjNone\(\);\n  \} catch \{/);
  assert.doesNotMatch(PAGE, /PJ_LOADED_ONCE = true;\n    paintPjNone\(\);/);
  // leaving the consolidated view without a reload repaints the board so the chosen layout comes back
  assert.match(PAGE, /const wasCons = document\.body\.classList\.contains\('consolidated'\);\n  document\.body\.classList\.toggle\('consolidated', cons\);/);
  assert.match(PAGE, /\n  if \(wasCons && !cons\) boardApplyVisibility\(agents\);/);
  // painted on every view change and every fold change, and only in the consolidated view
  assert.match(PAGE, /document\.getElementById\('pj-' \+ v \+ '-view'\)\.hidden = \(v !== which\);\n  \}\n  paintPjNone\(which\);/);
  assert.match(PAGE, /aria-label', \(on \? 'Open' : 'Fold'\)[^\n]*\n    \}\n  \}\n  paintPjNone\(\);\n\}/, 'railFoldsApply repaints the sentence after every fold change');
  // it sits in the centre column on the first row, so the projects rail is not pushed down a row
  assert.match(PAGE, /body\.consolidated #pj-none \{ grid-column: 2; grid-row: 1; align-self: start;/);
});

/* The sentence's whole table, run through the real function with a small
   document shim, so a wording or a branch can only change here on purpose. */
function paintWith(state) {
  const src = PAGE.match(/function paintPjNone\(which\) \{[\s\S]*?\n\}\n/)[0];
  const el = { hidden: true, textContent: '' };
  const classes = new Set(state.classes || []);
  const document = { getElementById: (id) => (id === 'pj-none' ? el : null), body: { classList: { contains: (c) => classes.has(c) } } };
  const fn = new Function('document', 'PJ_VIEW', 'PJ_LOADED_ONCE', 'PJ_READ_FAILED', 'PROJECTS', src + '\nreturn paintPjNone;')(
    document, state.view || 'list', state.loaded !== false, state.failed === true, state.projects || []);
  fn(state.which);
  return el.hidden ? null : el.textContent;
}
test('the sentence table: every state says one true thing or nothing', () => {
  const one = [{ id: 'a' }];
  assert.equal(paintWith({ classes: [] }), null, 'tab view: never');
  assert.equal(paintWith({ classes: ['consolidated'], view: 'one', projects: one }), null, 'a project open: nothing');
  assert.equal(paintWith({ classes: ['consolidated'], view: 'add', projects: one }), null, 'the New project form open: nothing');
  assert.equal(paintWith({ classes: ['consolidated'], projects: one }), 'Nothing is open yet. Pick a project on the left, or press + above the project list to start one.');
  assert.equal(paintWith({ classes: ['consolidated', 'fold-p'], projects: one }), 'Nothing is open yet. The projects list is folded; press \u203a at the top of the narrow column to open it.');
  assert.equal(paintWith({ classes: ['consolidated', 'fold-p', 'fold-a'], projects: one }), 'Nothing is open yet. The projects list is folded; press \u203a at the top of the second narrow column to open it.');
  assert.equal(paintWith({ classes: ['consolidated'], projects: [] }), null, 'no projects, rail open: the rail card says it');
  assert.equal(paintWith({ classes: ['consolidated', 'fold-p'], projects: [] }), 'No projects yet. Press + at the top of the narrow column to start one.');
  assert.equal(paintWith({ classes: ['consolidated', 'fold-p', 'fold-a'], projects: [] }), 'No projects yet. Press + at the top of the second narrow column to start one.');
  assert.equal(paintWith({ classes: ['consolidated'], projects: [], loaded: false }), 'Nothing is open yet. Pick a project on the left, or press + above the project list to start one.', 'before the first read: never "no projects"');
  assert.equal(paintWith({ classes: ['consolidated'], projects: [], failed: true }), null, 'read failed, rail open: silence beside the rail\'s own message');
  assert.equal(paintWith({ classes: ['consolidated', 'fold-p'], projects: [], failed: true }), 'Nothing is open yet. The projects list is folded; press \u203a at the top of the narrow column to open it.', 'read failed, rail folded: open the column and see');
  assert.equal(paintWith({ classes: ['consolidated'], view: 'one', projects: one, which: 'list' }), 'Nothing is open yet. Pick a project on the left, or press + above the project list to start one.', 'an explicit which wins over the record');
});

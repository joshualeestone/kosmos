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
  assert.match(PAGE, /'Nothing is open yet\. Pick a project on the left, or press \+ to start one\.'/);
  assert.match(PAGE, /'No projects yet\. Press \+ at the top of the projects column to start one\.'/);
  assert.match(PAGE, /'Nothing is open\. The projects list is folded; press \\u203a at the top of the '\n\s*\+ \(cls\.contains\('fold-a'\) \? 'second narrow column' : 'narrow column'\)/, 'both rails folded: the sentence says which narrow column');
  // the view is the record, never the DOM (the list stays visible beside the New project form in the consolidated layout)
  assert.match(PAGE, /const view = which === undefined \? PJ_VIEW : which;\n  const show = document\.body\.classList\.contains\('consolidated'\) && view === 'list';/);
  // "No projects yet" only after a read has happened
  assert.match(PAGE, /const empty = PJ_LOADED_ONCE && PROJECTS\.length === 0;/);
  assert.match(PAGE, /PROJECTS = body\.projects \|\| \[\];\n    PJ_LOADED_ONCE = true;\n    paintPjNone\(\);/);
  // painted on every view change and every fold change, and only in the consolidated view
  assert.match(PAGE, /document\.getElementById\('pj-' \+ v \+ '-view'\)\.hidden = \(v !== which\);\n  \}\n  paintPjNone\(which\);/);
  assert.match(PAGE, /aria-label', \(on \? 'Open' : 'Fold'\)[^\n]*\n    \}\n  \}\n  paintPjNone\(\);\n\}/, 'railFoldsApply repaints the sentence after every fold change');
  // it sits in the centre column on the first row, so the projects rail is not pushed down a row
  assert.match(PAGE, /body\.consolidated #pj-none \{ grid-column: 2; grid-row: 1; align-self: start;/);
});

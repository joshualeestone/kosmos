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
  assert.match(PAGE, /'Nothing is open\. The projects list is folded; press \\u203a at the top of the narrow column to open it, then pick a project\.'/);
  // painted on every view change and every fold change, and only in the consolidated view
  assert.match(PAGE, /document\.getElementById\('pj-' \+ v \+ '-view'\)\.hidden = \(v !== which\);\n  \}\n  paintPjNone\(which\);/);
  assert.match(PAGE, /\n  paintPjNone\(\);\n\}\nfunction railFoldsApply\(\)|aria-label', \(on \? 'Open' : 'Fold'\)[^\n]*\n    \}\n  \}\n  paintPjNone\(\);\n\}/);
  assert.match(PAGE, /const cons = document\.body\.classList\.contains\('consolidated'\);\n  const show = cons && /);
  // it sits in the centre column on the first row, so the projects rail is not pushed down a row
  assert.match(PAGE, /body\.consolidated #pj-none \{ grid-column: 2; grid-row: 1; align-self: start;/);
});

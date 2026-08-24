'use strict';
/**
 * #520: the consolidated view is one option in Settings > Styles, tabs by
 * default. What this pins: the picker's two tiles with tabs checked in the
 * markup; the page writes data-layout only from what the engine answered
 * (never from a click alone); the mode exists only at 1280px and up; and the
 * consolidated CSS never removes the board's grid or list from the page, it
 * re-lays them.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.slice(PAGE.lastIndexOf('<script>'));

test('the picker sits at the top of Styles with two tiles, tabs checked in the markup', () => {
  const at = PAGE.indexOf('id="s-sec-styles"');
  const theme = PAGE.indexOf('id="style-theme"', at);
  const sec = PAGE.slice(at, theme);
  assert.match(sec, /id="layout-field"/, 'the picker is not in Styles, above the theme');
  assert.match(sec, /role="radio" aria-checked="true" data-layout-pick="tabs"/);
  assert.match(sec, /role="radio" aria-checked="false" data-layout-pick="consolidated"/);
  assert.match(sec, /Needs a window at least 1280 pixels wide; narrower than that, the tabs come back\./);
  assert.equal((PAGE.match(/data-layout-pick="/g) || []).length, 2);
});

test('the root attribute is written from the engine\'s answer, and a click only asks the engine', () => {
  const fn = SCRIPT.slice(SCRIPT.indexOf('function applyLayout('), SCRIPT.indexOf('function applyStyle('));
  assert.match(fn, /document\.documentElement\.setAttribute\('data-layout', want\)/);
  assert.match(fn, /const want = layout === 'consolidated' \? 'consolidated' : 'tabs'/, 'anything but consolidated is the tabs');
  const click = fn.slice(fn.indexOf("addEventListener('click'"));
  assert.match(click, /fetch\('\/api\/style', \{ method: 'PUT'/);
  assert.match(click, /applyLayout\(r\.layout, true\)/, 'the click applies its own wish rather than the engine\'s answer');
  assert.doesNotMatch(click, /setAttribute\('data-layout'/, 'the click writes the root attribute directly');
  assert.match(SCRIPT, /applyLayout\(r\.layout, apply\);/, 'paintStyles does not carry the layout');
});

test('the mode is gated on width and on the two tabs it merges; Settings stays a whole page', () => {
  assert.match(SCRIPT, /window\.innerWidth >= 1280/);
  const st = SCRIPT.slice(SCRIPT.indexOf('function showTab('), SCRIPT.indexOf('function showTab(') + 4000);
  assert.match(st, /const cons = layoutConsolidated\(\) && \(tab === 'agents' \|\| tab === 'projects'\)/);
  assert.match(st, /document\.body\.classList\.toggle\('consolidated', cons\)/);
  assert.match(PAGE, /@media \(min-width: 1280px\) \{\s*html\[data-layout="consolidated"\] body\.consolidated \{ display: grid/);
});

test('the consolidated CSS re-lays the board list and the projects panel; it hides nothing a person needs', () => {
  const css = PAGE.slice(PAGE.indexOf('/* ---- #520: the consolidated view'), PAGE.indexOf('.laytiles {'));
  assert.ok(css.length > 200, 'the CSS block moved; re-anchor');
  const block = PAGE.slice(PAGE.indexOf('@media (min-width: 1280px) {\n  html[data-layout="consolidated"]'), PAGE.indexOf('.laytiles {') + 3000);
  assert.match(block, /> #alist \{ grid-column: 1/);
  assert.match(block, /> #panel-projects \{ grid-column: 2/);
  assert.doesNotMatch(block, /#pj-room[^}]*display: none|\.composer[^}]*display: none|#pj-room-search[^}]*display: none/, 'the room, its search or its composer is hidden in the consolidated view');
});

test('no em dash in what a person reads', () => {
  const at = PAGE.indexOf('id="layout-field"');
  assert.doesNotMatch(PAGE.slice(at, at + 4000), /—/);
});

test('piece two: the rail heads exist once, hidden until the mode, with a + on the board\'s own actions and a fold per rail', () => {
  assert.equal((PAGE.match(/id="rail-agents"/g) || []).length, 1);
  assert.equal((PAGE.match(/id="rail-projects"/g) || []).length, 1);
  assert.match(PAGE, /<div class="railhead" id="rail-agents" hidden>/);
  assert.match(PAGE, /<div class="railhead" id="rail-projects" hidden>/);
  assert.match(SCRIPT, /getElementById\('rail-agents'\)\.hidden = !cons/);
  assert.match(SCRIPT, /getElementById\('rail-agents-new'\)\.addEventListener\('click', \(\) => document\.getElementById\('new-agent'\)\.click\(\)\)/, 'the rail + is not the board\'s own New agent');
  assert.match(SCRIPT, /getElementById\('rail-projects-new'\)\.addEventListener\('click', \(\) => document\.getElementById\('pj-new'\)\.click\(\)\)/, 'the rail + is not the list\'s own New project');
  assert.match(SCRIPT, /sessionStorage\.getItem\('rail-fold-' \+ k\)/, 'a fold is not per session');
  assert.match(PAGE, /body\.consolidated\.fold-a \{ grid-template-columns: 48px/);
  assert.match(PAGE, /body\.consolidated\.fold-p #panel-projects \{ grid-template-columns: 48px/);
});

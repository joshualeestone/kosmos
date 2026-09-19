'use strict';
/**
 * #3276 (Josh, 2026-09-18): the Projects board settles on TWO views -- Grid + Roadmap --
 * replacing three (Grid / List / org-chart Map). These are the SOURCE-level guards that
 * run without a browser (the rendered behaviour is in
 * docs/browser-checks/render-projects-roadmap-3276.js): the toggle offers exactly
 * grid + roadmap, LAYOUTS.projects lists exactly those two, and the migration maps a
 * retired list/map preference to roadmap (the real sliced function, so it cannot drift
 * from the shipped one).
 *
 *   node --test web.roadmap-twoview-3276.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

test('the projects viewtoggle offers exactly Grid + Roadmap (no List, no Map)', () => {
  const box = PAGE.slice(PAGE.indexOf('<div class="viewtoggle" role="group" aria-label="How to show projects"'));
  const toggle = box.slice(0, box.indexOf('</div>') + 6);
  const layouts = [...toggle.matchAll(/data-layout="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(layouts, ['grid', 'roadmap'], 'the projects toggle must be exactly grid + roadmap, in that order: ' + JSON.stringify(layouts));
  assert.doesNotMatch(toggle, /data-layout="list"/, 'the List button must be gone');
  assert.doesNotMatch(toggle, /data-layout="map"/, 'the org-chart Map button must be gone');
  assert.match(toggle, /aria-label="Show projects as a roadmap"/, 'the Roadmap button keeps an accessible name');
});

test('LAYOUTS.projects lists exactly grid + roadmap and drops mapEl', () => {
  const line = PAGE.match(/projects:\s*\{[^}]*\}/);
  assert.ok(line, 'LAYOUTS.projects entry not found');
  assert.match(line[0], /layouts:\s*\['grid',\s*'roadmap'\]/, 'LAYOUTS.projects.layouts must be exactly grid + roadmap: ' + line[0]);
  assert.doesNotMatch(line[0], /mapEl/, 'mapEl must be gone (the org-chart container is retired from the toggle)');
});

test('pjLayoutMigrate (the real sliced function) maps a retired list/map to roadmap, and leaves the rest', () => {
  const m = PAGE.match(/function pjLayoutMigrate\(v\) \{[^}]*\}/);
  assert.ok(m, 'pjLayoutMigrate is gone from the page');
  // eslint-disable-next-line no-new-func
  const pjLayoutMigrate = new Function(m[0] + '\nreturn pjLayoutMigrate;')();
  assert.equal(pjLayoutMigrate('list'), 'roadmap', 'a saved list migrates to roadmap');
  assert.equal(pjLayoutMigrate('map'), 'roadmap', 'a saved map migrates to roadmap');
  assert.equal(pjLayoutMigrate('grid'), 'grid', 'grid is unchanged');
  assert.equal(pjLayoutMigrate('roadmap'), 'roadmap', 'roadmap is unchanged');
  assert.equal(pjLayoutMigrate(null), null, 'an unset value is left as-is (the allowlist then falls it back)');
  assert.equal(pjLayoutMigrate('org'), 'org', 'a foreign value is left as-is (agents-only org is not remapped)');
});

test('the boot restore migrates the projects scope only, and persists the rewrite once', () => {
  // The boot loop reads localStorage then, for the projects scope, migrates + persists.
  // Source-level pins so the projects-only guard and the one-time persist cannot silently drop.
  assert.match(PAGE, /if \(scope === 'projects'\) \{\s*const migrated = pjLayoutMigrate\(saved\);/,
    'the boot migration must be gated on the projects scope (the agents scope keeps its own list/org)');
  assert.match(PAGE, /if \(migrated !== saved\) \{\s*saved = migrated;\s*try \{ localStorage\.setItem\('kosmos\.layout\.projects', saved\)/,
    'the boot migration must persist the rewrite only when it actually changed the value');
});

test('the fold gate is treeMode (consolidated rail OR tab roadmap), not consolidated-only', () => {
  // #3276 generalised applyConsFold from body.consolidated to "any foldable tree view".
  assert.match(PAGE, /const treeMode = !list\.classList\.contains\('asgrid'\);/,
    'applyConsFold must compute treeMode from the .asgrid class (the CSS discriminator), so grid never folds');
  assert.match(PAGE, /const shouldHide = treeMode && depth > cutoff;/,
    'the fold-hide must be gated on treeMode, so the tab Roadmap folds too');
  // Drag stays consolidated-only.
  assert.match(PAGE, /row\.draggable = cons && depth === 0;/,
    'drag-to-reorder must stay consolidated-only (cons), not treeMode');
});

'use strict';

/* #2487: pjAncestry unit test. projectCard's ancestry "mouseprint" walks parent
 * ids up the tree; this pins the chain, the dangling-parent fallback, and the
 * self/loop guard that the Playwright browser check cannot easily construct (a
 * real stored cycle). Extracts the SHIPPED pjAncestry from web/index.html and
 * binds it to a test pjById, so the test exercises the real function, not a copy.
 *
 *   node --test web.pj-ancestry-2487.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const src = PAGE.match(/function pjAncestry\(p\)\s*\{[\s\S]*?\n\}/);
assert.ok(src, 'pjAncestry source not found in web/index.html (did it move or get renamed?)');

// Rebuild the shipped function with pjById injected as its only free variable.
// eslint-disable-next-line no-new-func
const bind = new Function('pjById', src[0] + '\nreturn pjAncestry;');
function ancestryFor(projects, id) {
  const byId = new Map(projects.map((x) => [x.id, x]));
  const pjById = (i) => byId.get(i) || null;
  return bind(pjById)(byId.get(id));
}

const TREE = [
  { id: 'tp', name: 'Top Project' },
  { id: 'a', name: 'Project 1A', parent: 'tp' },
  { id: 'a1', name: 'Project 1A-1', parent: 'a' },
  { id: 'a11', name: 'Project 1A-1-1', parent: 'a1' },
  { id: 'gs', name: 'Getting started' },
  { id: 'dang', name: 'Orphan', parent: 'gone', parentName: 'Archived Parent' },
  { id: 'cyc', name: 'Cyclic', parent: 'cyc' },
  { id: 'ab', name: 'A', parent: 'ba' }, { id: 'ba', name: 'B', parent: 'ab' },
];

test('pjAncestry: root-first chains at each depth', () => {
  assert.deepEqual(ancestryFor(TREE, 'tp'), [], 'a top-level project has no ancestry');
  assert.deepEqual(ancestryFor(TREE, 'a'), ['Top Project']);
  assert.deepEqual(ancestryFor(TREE, 'a1'), ['Top Project', 'Project 1A']);
  assert.deepEqual(ancestryFor(TREE, 'a11'), ['Top Project', 'Project 1A', 'Project 1A-1'],
    'great-grandchild returns the full chain (projectCard middle-elides it for display)');
  assert.deepEqual(ancestryFor(TREE, 'gs'), []);
});

test('pjAncestry: dangling parent falls back to parentName, never silently empty', () => {
  assert.deepEqual(ancestryFor(TREE, 'dang'), ['Archived Parent'],
    'when the parent record is not loaded, the stored parentName still shows');
});

test('pjAncestry: cycle guard terminates and never lists a project as its own ancestor', () => {
  assert.deepEqual(ancestryFor(TREE, 'cyc'), [],
    'a self-loop (parent === self) yields no ancestry, and does not hang');
  assert.deepEqual(ancestryFor(TREE, 'ab'), ['B'],
    'a two-node cycle stops before looping back to the queried project');
});

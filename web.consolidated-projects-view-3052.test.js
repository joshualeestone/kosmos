'use strict';

/**
 * #3052: the consolidated view's projects panel has its OWN view (the readable
 * list), independent of the Projects TAB's saved grid/list choice. Before this fix,
 * a tab left on a wide layout made the narrow consolidated panel draw it too, where
 * Josh "can't see anything". (The original symptom was the project org-chart Map,
 * retired in #3276 and its code removed in #3279; the fix generalises to any wide
 * tab layout.)
 *
 * These EXTRACT and RUN the shipped placeProjectsView against a stub DOM +
 * localStorage, so the controls return the dangerous answer without a browser:
 * a consolidated view that leaves a wide layout on, or a restore that writes storage.
 * The showTab wiring is pinned with a source-pattern assertion.
 *
 *   node --test web.consolidated-projects-view-3052.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

// Slice placeProjectsView from its signature to the first column-0 `\n}` (its own
// close; the inner if/else/try braces are indented).
function grab(sig) {
  const at = PAGE.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the page');
  return PAGE.slice(at, PAGE.indexOf('\n}', at) + 2);
}
const FN_SRC = grab('function placeProjectsView(');

// A minimal classList stub backed by a Set.
function classList(initial) {
  const s = new Set(initial || []);
  return {
    _set: s,
    add: (c) => s.add(c),
    remove: (c) => s.delete(c),
    contains: (c) => s.has(c),
    toggle: (c, on) => (on ? s.add(c) : s.delete(c)),
  };
}

// Build a scope with placeProjectsView + the stubs it needs. Returns the fn plus
// the observable stubs (body classList, the map/list elements, layoutApply calls,
// and every localStorage.setItem the fn made).
function scope({ storageThrows, saved } = {}) {
  // The body is seeded consolidated with #pj-list.asgrid set, so the consolidated
  // branch's grid-class clear is observable. (#3279 retired the Map, so there is no
  // pj-mapmode / #pj-map state left to seed or clear.)
  const body = { classList: classList(['consolidated']) };
  const list = { classList: classList(['asgrid']) };
  const document = {
    body,
    getElementById: (id) => (id === 'pj-list' ? list : null),
  };
  const writes = [];
  const store = new Map(saved ? [['kosmos.layout.projects', saved]] : []);
  const localStorage = {
    getItem: (k) => { if (storageThrows) throw new Error('blocked'); return store.has(k) ? store.get(k) : null; },
    setItem: (k, v) => { writes.push([k, v]); if (storageThrows) throw new Error('blocked'); store.set(k, v); },
  };
  const layoutApplyCalls = [];
  const layoutApply = (s, w, p) => layoutApplyCalls.push([s, w, p]);
  /* #3276: the Projects board is two views now -- grid + roadmap. The retired list/map
     values migrate to roadmap on read (pjLayoutMigrate), which placeProjectsView calls,
     so it is injected here (the sliced fn references it as a free name -- the
     eval-sliced-node-test trap). Inject the REAL sliced pjLayoutMigrate, not a hand-rolled
     copy: a regression in the shipped function (dropped case, wrong target) must fail THIS
     file's placeProjectsView tests, not pass against a local duplicate that can't drift. */
  const LAYOUTS = { projects: { layouts: ['grid', 'roadmap'], fallback: 'grid' } };
  const migrateSrc = PAGE.match(/function pjLayoutMigrate\(v\) \{[^}]*\}/);
  assert.ok(migrateSrc, 'pjLayoutMigrate is gone from the page');
  // eslint-disable-next-line no-new-func
  const pjLayoutMigrate = new Function(migrateSrc[0] + '\nreturn pjLayoutMigrate;')();
  const factory = new Function('document', 'localStorage', 'layoutApply', 'LAYOUTS', 'pjLayoutMigrate', `
    ${FN_SRC}
    return placeProjectsView;
  `);
  const fn = factory(document, localStorage, layoutApply, LAYOUTS, pjLayoutMigrate);
  return { fn, body, list, writes, layoutApplyCalls };
}

test('#3052: consolidated forces the list -- drops the grid class', () => {
  const s = scope({ saved: 'grid' });
  s.fn(true, false);
  assert.equal(s.list.classList.contains('asgrid'), false, 'the grid class must be off (list, not grid)');
});

test('#3052 control: the consolidated force is DISPLAY-ONLY -- it never writes localStorage', () => {
  const s = scope({ saved: 'map' });
  s.fn(true, false);
  assert.deepEqual(s.writes, [], 'forcing the list in consolidated must not persist a layout (the tab choice must survive)');
  assert.deepEqual(s.layoutApplyCalls, [], 'the consolidated branch must not re-run layoutApply');
});

test('#3052/#3276: leaving consolidated restores the saved tab layout, migrating a retired map/list to roadmap', () => {
  const s = scope({ saved: 'map' });
  s.fn(false, true);
  assert.deepEqual(s.layoutApplyCalls, [['projects', 'roadmap', undefined]], 'a saved map must restore as roadmap on exit (#3276 migration), not a dead key');
  const l = scope({ saved: 'list' });
  l.fn(false, true);
  assert.deepEqual(l.layoutApplyCalls, [['projects', 'roadmap', undefined]], 'a saved list must restore as roadmap on exit (#3276 migration)');
  const g = scope({ saved: 'grid' });
  g.fn(false, true);
  assert.deepEqual(g.layoutApplyCalls, [['projects', 'grid', undefined]], 'grid is unchanged by the migration');
});

test('#3052 control: an unreadable/foreign saved value falls back to grid, never guesses', () => {
  const foreign = scope({ saved: 'org' });   // org is an agents-only layout, not in projects
  foreign.fn(false, true);
  assert.deepEqual(foreign.layoutApplyCalls, [['projects', 'grid', undefined]], 'a foreign value must fall back to the projects default');
  const blocked = scope({ storageThrows: true });
  blocked.fn(false, true);
  assert.deepEqual(blocked.layoutApplyCalls, [['projects', 'grid', undefined]], 'a blocked read must fall back to the default, not throw');
});

test('#3052 control: not entering or leaving consolidated is a no-op', () => {
  const s = scope({ saved: 'map' });
  s.fn(false, false);   // tab view, was tab view -> honor the saved mode, do nothing
  assert.deepEqual(s.layoutApplyCalls, [], 'a pure tab-view pass must not restore (it would fight a live layout selection)');
  assert.equal(s.list.classList.contains('asgrid'), true, 'the tab view keeps its grid class untouched (neither branch runs)');
  assert.deepEqual(s.writes, []);
});

test('#3052 wiring: showTab calls placeProjectsView(cons, wasCons) before the consolidated loadProjects', () => {
  // showTab is the only caller; assert on the page rather than slicing that large
  // function (its nested blocks make a brace-slice unreliable).
  const call = PAGE.indexOf('placeProjectsView(cons, wasCons)');
  assert.notEqual(call, -1, 'showTab no longer calls placeProjectsView(cons, wasCons)');
  // The showTab body has placeProjectsView near its top and loadProjects() lower down; the
  // NEXT loadProjects() after the call must be the consolidated repaint it precedes, so the
  // map class is already cleared when paintProjects reads it.
  const load = PAGE.indexOf('loadProjects()', call);
  assert.notEqual(load, -1, 'no loadProjects() found after the placeProjectsView call');
  assert.ok(call < load, 'placeProjectsView must run before loadProjects()');
  // And it is defined exactly once (the helper), plus called once (in showTab).
  assert.equal((PAGE.match(/function placeProjectsView\(/g) || []).length, 1, 'placeProjectsView should be defined once');
});

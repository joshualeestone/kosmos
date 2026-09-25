'use strict';
/* #3559: the Tasks view's page logic, on the REAL functions lifted from web/index.html
 * (window, search, sort, scope), plus the wiring a tab needs (nav button, both allowlists,
 * showTab's load) and the two rules the build lives by: only provable groups, and no coloured
 * left bar in its styles.
 *
 *   node --test web.tasks-view-3559.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const FNS = page.liftAll(SCRIPT, ['tskAgentName', 'tskInWindow', 'tskMatches', 'tskSort', 'tskScoped']);
const make = new Function('LAST', FNS + '\nreturn { tskAgentName, tskInWindow, tskMatches, tskSort, tskScoped };');
const api = make([{ sessionName: 'rex', name: 'Rex' }, { sessionName: 'ada', name: 'Ada' }]);

const NOW = Date.parse('2026-09-25T06:00:00Z');
const h = (hours) => new Date(NOW - hours * 3600000).toISOString();
const T = [
  { number: 1, projectId: 'a', projectName: 'Spring launch', sentence: 'Book the podcast tour', whoNames: [], state: 'nobody', createdAt: h(70), lastActivityAt: h(70) },
  { number: 2, projectId: 'a', projectName: 'Spring launch', sentence: 'Order proof copies', whoNames: ['rex'], state: 'assigned', createdAt: h(10), lastActivityAt: h(1) },
  { number: 7, projectId: 'b', projectName: 'Newsletter', sentence: 'Clean up bounced addresses', whoNames: ['rex'], state: 'working', createdAt: h(30), lastActivityAt: h(20) },
  { number: 12, projectId: 'b', projectName: 'Newsletter', sentence: 'Welcome email', whoNames: [], state: 'closed', createdAt: h(900), lastActivityAt: null },
];

test('the agent name is the board roster\'s, falling back to the session name', () => {
  assert.equal(api.tskAgentName('rex'), 'Rex');
  assert.equal(api.tskAgentName('ghost'), 'ghost');
});

test('Added in: a window keeps only tasks made inside it; All keeps everything', () => {
  assert.deepEqual(T.filter((t) => api.tskInWindow(t, 1, NOW)).map((t) => t.number), [2]);
  assert.deepEqual(T.filter((t) => api.tskInWindow(t, 2, NOW)).map((t) => t.number), [2, 7]);
  assert.equal(T.filter((t) => api.tskInWindow(t, 0, NOW)).length, 4);
  assert.equal(api.tskInWindow({ createdAt: 'not a date' }, 7, NOW), false, 'an unknown date is not inside a window');
});

test('search: what it says, its number, its project and its agent (by either name); every word must match', () => {
  const find = (q) => T.filter((t) => api.tskMatches(t, q)).map((t) => t.number);
  assert.deepEqual(find('podcast'), [1]);
  assert.deepEqual(find('#7'), [7]);
  assert.deepEqual(find('12'), [12]);
  assert.deepEqual(find('newsletter'), [7, 12]);
  assert.deepEqual(find('Rex'), [2, 7], 'the shown name finds the agent');
  assert.deepEqual(find('rex proof'), [2], 'two words narrow, not widen');
  assert.deepEqual(find('   '), [1, 2, 7, 12], 'an empty search is no filter');
  assert.deepEqual(find('nothing-like-this'), []);
});

test('sort: newest, oldest, and quietest first (unknown activity last, never floated up as quiet)', () => {
  assert.deepEqual(api.tskSort(T, 'new').map((t) => t.number), [2, 7, 1, 12]);
  assert.deepEqual(api.tskSort(T, 'old').map((t) => t.number), [12, 1, 7, 2]);
  assert.deepEqual(api.tskSort(T, 'stale').map((t) => t.number), [1, 7, 2, 12]);
  assert.notEqual(api.tskSort(T, 'new'), T, 'sorting must not reorder the caller\'s array');
});

test('scope: project, window and search combine', () => {
  const pick = (st) => api.tskScoped(T, Object.assign({ proj: null, win: 0, q: '' }, st), NOW).map((t) => t.number);
  assert.deepEqual(pick({ proj: 'b' }), [7, 12]);
  assert.deepEqual(pick({ proj: 'b', q: 'rex' }), [7]);
  assert.deepEqual(pick({ win: 2, q: 'rex' }), [2, 7]);
});

test('only the groups the engine can prove are defined, in the mock\'s order', () => {
  const m = SCRIPT.match(/const TSK_GROUPS = \[([\s\S]*?)\n\];/);
  assert.ok(m, 'TSK_GROUPS moved; update this test');
  const keys = [...m[1].matchAll(/\bk: '([a-z]+)'/g)].map((x) => x[1]);
  assert.deepEqual(keys, ['nobody', 'assigned', 'working', 'closed']);
  assert.doesNotMatch(m[1], /Waiting on you|Done, check it/, 'an unprovable group is drawn');
});

test('the wiring: a Tasks tab, both allowlists, showTab loads it, and the consolidated rail has a way in', () => {
  assert.match(PAGE, /<button class="tab"\s+data-tab="tasks"\s+role="tab"/);
  assert.match(SCRIPT, /const PANELS = \[[^\]]*'tasks'/);
  assert.match(SCRIPT, /const KNOWN_TABS = \[[^\]]*'tasks'/, 'a ?tab=tasks bookmark would land on Agents');
  assert.match(SCRIPT, /if \(tab === 'tasks'\) tskLoad\(\);/);
  assert.match(PAGE, /<section class="panel panel-wide" id="panel-tasks" hidden>/);
  assert.match(PAGE, /id="rail-projects-tasks"/);
  assert.match(SCRIPT, /getElementById\('rail-projects-tasks'\)\.addEventListener\('click', \(\) => showTab\('tasks'\)\)/);
  assert.match(PAGE, /id="tsk-search" type="search"/, 'the search box must be type=search (Enter must not submit)');
});

test('no Tasks style declares a left border (Josh, 2026-09-24: no coloured bar down a left edge)', () => {
  const rules = [...PAGE.matchAll(/^[^\n{]*(?:\.tsk-|#panel-tasks|\.rail-tasks)[^\n{]*\{[^}]*\}/gm)].map((x) => x[0]);
  assert.ok(rules.length > 20, 'the Tasks rules were not found; update this test');
  /* A 1px NEUTRAL rule between segmented buttons is a divider, not a coloured bar; anything
     wider, or in any colour but the neutral --k-rule, is the thing Josh ruled out. */
  const bad = rules.flatMap((r) => [...r.matchAll(/border-(?:left|inline-start)[^;}]*/g)].map((m) => m[0]))
    .filter((d) => !/^border-left:\s*1px solid var\(--k-rule\)$/.test(d.trim()));
  assert.deepEqual(bad, []);
  // The check can see a bar (control): a coloured 3px left edge fails it.
  assert.ok(!/^border-left:\s*1px solid var\(--k-rule\)$/.test('border-left: 3px solid var(--gold)'));
});

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
const os = require('node:os');
// The roster (LAST) is REAL board cards (fixture-discipline): sandbox the roots before the fleet.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tasksview-page-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
const page = require('./test-support/page');
const fleet = require('./test-support/fleet');
const BOARD = fleet.install([fleet.agent('rex', { displayName: 'Rex' }), fleet.agent('ada', { displayName: 'Ada' })]);
test.after(() => { try { BOARD.restore(); } catch { /* restored */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const FNS = page.liftAll(SCRIPT, ['tskAgentName', 'tskInWindow', 'tskMatches', 'tskSort', 'tskScoped']);
const make = new Function('LAST', FNS + '\nreturn { tskAgentName, tskInWindow, tskMatches, tskSort, tskScoped };');
const api = make(BOARD.agents);

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
  // "#N" names one task: #1 is not #12 (the fixture has both, so a substring match fails this).
  assert.deepEqual(find('#1'), [1]);
  assert.deepEqual(find('#1 podcast'), [1]);
  assert.deepEqual(find('#12'), [12]);
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

test('#3949 only the groups the engine can prove are defined, in Josh\'s order, one label each', () => {
  const m = SCRIPT.match(/const TSK_GROUPS = \[([\s\S]*?)\n\];/);
  assert.ok(m, 'TSK_GROUPS moved; update this test');
  const keys = [...m[1].matchAll(/\bk: '([a-z]+)'/g)].map((x) => x[1]);
  assert.deepEqual(keys, ['decision', 'working', 'assigned', 'nobody', 'closed']);
  const labels = [...m[1].matchAll(/\bl: '([^']+)'/g)].map((x) => x[1]);
  assert.deepEqual(labels, ['Needs Your Decision', 'In progress', 'Assigned but not started', 'Unassigned', 'Completed']);
  assert.doesNotMatch(m[1], /\bs: '/, 'a group carries a byline again');
  assert.doesNotMatch(m[1], /Built but waiting|Waiting on you|Done, check it/, 'an unprovable group is drawn (#3951)');
  assert.match(m[1], /k: 'decision', l: 'Needs Your Decision', c: 'var\(--tsk-decision\)'/);
  assert.match(PAGE, /--tsk-decision: var\(--danger\);/, 'Needs Your Decision is not red');
});

test('#3949 the layout: no Projects rail, search beside the count, Project and Created: dropdowns on one row, Group by and Sort under the tiles', () => {
  const view = PAGE.slice(PAGE.indexOf('<section class="panel panel-wide" id="panel-tasks" hidden>'));
  const body = view.slice(0, view.indexOf('</section>'));
  assert.doesNotMatch(body, /tsk-rail|id="tsk-projects"|tsk-mobsel/, 'the left Projects column is back');
  assert.doesNotMatch(PAGE, /Tap a tile to see only that group/, 'the tile hint is back');
  assert.doesNotMatch(PAGE, /\.tsk-view \{[^}]*grid-template-columns/, 'the view still reserves a rail column');
  const at = (re) => { const i = body.search(re); assert.ok(i >= 0, 'missing: ' + re); return i; };
  // Search and the count share the top row, the count to the right.
  const top = body.slice(at(/<div class="tsk-toprow">/), at(/<div class="tsk-ctrls" id="tsk-filters">/));
  assert.ok(top.indexOf('id="tsk-search"') >= 0 && top.indexOf('id="tsk-sub"') > top.indexOf('id="tsk-search"'), 'the count is not to the right of the search');
  // Project and Created: are dropdowns on one row, above the tiles.
  const filters = body.slice(at(/id="tsk-filters"/), at(/id="tsk-tiles"/));
  assert.match(filters, /<select class="tsk-sel" id="tsk-projsel">/);
  assert.match(filters, /<label class="tsk-cl" for="tsk-win">Created:<\/label><select class="tsk-sel" id="tsk-win">/);
  // Group by and Sort are dropdowns under the tiles.
  const under = body.slice(at(/id="tsk-under"/));
  assert.ok(at(/id="tsk-under"/) > at(/id="tsk-tiles"/), 'Group by and Sort are not under the tiles');
  assert.match(under, /<label class="tsk-cl" for="tsk-by">Group by<\/label><select class="tsk-sel" id="tsk-by">/);
  assert.match(under, /id="tsk-sort"/);
  // The dropdowns drive the view.
  assert.match(SCRIPT, /if \(e\.target\.id === 'tsk-win'\) \{ TSK\.win = Number\(e\.target\.value\) \|\| 0; tskPaint\(\); return; \}/);
  assert.match(SCRIPT, /if \(e\.target\.id === 'tsk-by'\) \{ TSK\.by = e\.target\.value === 'project' \? 'project' : 'status'; tskPaint\(\); \}/);
  assert.match(SCRIPT, /by: 'status'/, 'Group by does not default to Status');
});

test('the wiring: a Tasks tab, both allowlists, showTab loads it, and the consolidated rail has a way in', () => {
  assert.match(PAGE, /<button class="tab"\s+data-tab="tasks"\s+role="tab"/);
  assert.match(SCRIPT, /const PANELS = \[[^\]]*'tasks'/);
  assert.match(SCRIPT, /const KNOWN_TABS = \[[^\]]*'tasks'/, 'a ?tab=tasks bookmark would land on Agents');
  assert.match(SCRIPT, /if \(tab === 'tasks'\) tskLoad\(true\);/, 'arriving on the tab does not load the view as an arrival');
  assert.match(PAGE, /<section class="panel panel-wide" id="panel-tasks" hidden>/);
  assert.match(PAGE, /id="rail-projects-tasks"/);
  assert.match(SCRIPT, /getElementById\('rail-projects-tasks'\)\.addEventListener\('click', openConsolidatedTasks\)/, 'the consolidated button must open Tasks inside the column, not kick out to the tabs (#2842)');
  assert.match(SCRIPT, /placeTasksPanel\(cons\);/, 'showTab does not place the Tasks panel with the layout');
  assert.match(SCRIPT, /for \(const id of \['panel-settings', 'panel-create', 'panel-tasks'\]\)/, 'taking over the display column does not hide the Tasks view');
  assert.match(SCRIPT, /if \(URL_TAB === 'tasks'\) return \{ screen: 'tasks' \};/, 'the setup guide is told the wrong screen on Tasks');
  assert.match(PAGE, /id="tsk-search" type="search"/, 'the search box must be type=search (frEnterSubmit-style Enter handlers and assistive tech read it as a search field)');
});

test('no Tasks style declares a left border (Josh, 2026-09-24: no coloured bar down a left edge)', () => {
  const rules = [...PAGE.matchAll(/^[^\n{]*(?:\.tsk-|#panel-tasks|\.rail-tasks)[^\n{]*\{[^}]*\}/gm)].map((x) => x[0]);
  assert.ok(rules.length > 20, 'the Tasks rules were not found; update this test');
  /* A 1px NEUTRAL rule between segmented buttons is a divider, not a coloured bar; anything
     wider, or in any colour but the neutral --k-rule, is the thing Josh ruled out. */
  const bad = rules.flatMap((r) => [...r.matchAll(/border-(?:left|inline-start)[^;}]*/g)].map((m) => m[0]))
    .filter((d) => !/^border-left:\s*1px solid var\(--k-rule\)$/.test(d.trim()));
  assert.deepEqual(bad, []);
  // CONTROL through the SAME extraction: a page with a planted coloured bar yields it.
  const planted = PAGE + '\n.tsk-planted { border-left: 3px solid var(--gold); }\n';
  const plantedBad = [...planted.matchAll(/^[^\n{]*(?:\.tsk-|#panel-tasks|\.rail-tasks)[^\n{]*\{[^}]*\}/gm)].map((x) => x[0])
    .flatMap((r) => [...r.matchAll(/border-(?:left|inline-start)[^;}]*/g)].map((m) => m[0]))
    .filter((d) => !/^border-left:\s*1px solid var\(--k-rule\)$/.test(d.trim()));
  assert.deepEqual(plantedBad, ['border-left: 3px solid var(--gold)'], 'the extraction cannot see a planted bar');
  // A bar can also be an inset shadow offset to the left; none may be, and the check can see one.
  const SHADOW_BAR = /box-shadow:[^;}]*inset\s+[1-9]\d*px\s+0/g;
  assert.deepEqual(rules.flatMap((r) => [...r.matchAll(SHADOW_BAR)].map((m) => m[0])), []);
  assert.equal([...'.tsk-x { box-shadow: inset 3px 0 0 var(--gold); }'.matchAll(SHADOW_BAR)].length, 1, 'the shadow check cannot see a shadow bar');
});

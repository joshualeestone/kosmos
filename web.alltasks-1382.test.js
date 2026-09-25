'use strict';

/**
 * The project View-all door (#1382), since #3703 opening the Tasks view scoped to its project.
 *
 * Josh (#1382): *"for tasks, i want to see a view of them in a list form basically"*, answering
 * his earlier *"where I can see ALL of the tasks"*. #3703 retired the separate all-tasks screen
 * for the Tasks view (#3559): ONE list screen, Mona's mock.
 *
 * 🔑 WHAT THE OLD SCREEN GUARANTEED, AND WHERE EACH GUARANTEE LIVES NOW (asserted below, not
 * assumed to have moved):
 *   - #1346, one array: the count and the rows cannot disagree. The Tasks view's sub-line count
 *     and its groups are both taken from `scoped`.
 *   - an unreadable read is SAID, never shown as an empty list (tskLoad sets TSK.error).
 *   - #2498, the door is per-project: it scopes the view to PJ_CURRENT.
 *   - a row opens its task on ITS OWN project (tskOpenTask goes to t.projectId).
 *   - closed tasks stay reachable per project: the door opens with the window at All.
 *   - the door carries no count (#1346's second number).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = require('./test-support/page');

const PAGE = fs.readFileSync(process.env.PLUS_PAGE || path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const body = (name) => {
  const at = SCRIPT.search(new RegExp('(?:async )?function ' + name + '\\('));
  assert.ok(at > -1, name + ' is gone; update this test');
  return SCRIPT.slice(at, SCRIPT.indexOf('\n}\n', at) + 2);
};

test('#3703: the old all-tasks screen is gone, and nothing still points at it', () => {
  assert.ok(!PAGE.includes('id="pj-alltasks-view"'), 'the retired screen is back');
  for (const id of ['alltasks-back', 'alltasks-count', 'alltasks-list', 'alltasks-msg', 'alltasks-desc']) {
    assert.ok(!PAGE.includes(id), `#${id} still appears in the page`);
  }
  assert.ok(!SCRIPT.includes('openAllTasksView'), 'the old screen\'s opener is still in the script');
  for (const m of SCRIPT.matchAll(/for \(const v of \[([^\]]*)\]\)/g)) {
    assert.doesNotMatch(m[1], /'alltasks'/, 'a project-view loop still lists the retired screen');
  }
  // CONTROL: the same loop pattern does find the project views, so the negative above is not vacuous.
  assert.ok([...SCRIPT.matchAll(/for \(const v of \[([^\]]*)\]\)/g)].some((m) => /'docs'/.test(m[1])), 'the view-loop pattern matches nothing; update this test');
});

test('#1382 + #3703: the door opens the Tasks view scoped to THIS project, unconditional and uncounted', () => {
  assert.match(SCRIPT, /getElementById\('pj-alltasks'\)\.addEventListener\('click', \(\) => openProjectTasks\(PJ_CURRENT\)\)/,
    'the door no longer opens the Tasks view for the current project');
  assert.match(SCRIPT, /door\.textContent = 'View All'/, 'the door lost its label');
  const OLD = "    door.textContent = 'View All (' + all.length + ')';";
  assert.match(OLD, /door\.textContent = 'View All \(' \+/, 'the forbidden pattern cannot match a counted door (control)');
  assert.doesNotMatch(SCRIPT, /door\.textContent = 'View All \(' \+/, 'a count is back on the door (#1346)');
});

/* openProjectTasks, run for real on the lifted source with a stub world. */
function harness({ consolidated }) {
  const calls = [];
  const els = { 'tsk-search': { value: 'left over' }, 'tsk-qclear': { hidden: false } };
  const document = {
    getElementById: (id) => els[id] || null,
    body: { classList: { contains: (c) => c === 'consolidated' && consolidated } },
  };
  const TSK = { proj: 'other', projHint: null, win: 7, tile: 'closed', q: 'left over', by: 'project', sort: 'stale' };
  const PROJECTS = [{ id: 'p1', name: 'Spring launch' }];
  const run = new Function('document', 'TSK', 'pjById', 'showTab', 'openConsolidatedTasks',
    body('openProjectTasks') + '\nreturn openProjectTasks;')(
    document, TSK, (id) => PROJECTS.find((p) => p.id === id) || null,
    (t) => calls.push('showTab:' + t), () => calls.push('openConsolidatedTasks'));
  return { run, TSK, els, calls };
}

test('#3703: a door is a fresh look at its project: scope set, window All, search and tile cleared, Group by and Sort kept', () => {
  const h = harness({ consolidated: false });
  h.run('p1');
  assert.equal(h.TSK.proj, 'p1');
  assert.deepEqual(h.TSK.projHint, { id: 'p1', name: 'Spring launch' }, 'an empty project would lose its name');
  assert.equal(h.TSK.win, 0, 'a remembered window would hide tasks the door promises (closed ones included)');
  assert.equal(h.TSK.tile, null);
  assert.equal(h.TSK.q, '');
  assert.equal(h.els['tsk-search'].value, '', 'the search box still shows the old words while the filter is cleared');
  assert.equal(h.els['tsk-qclear'].hidden, true);
  assert.equal(h.TSK.by, 'project', 'Group by is the person\'s own and must survive a door');
  assert.equal(h.TSK.sort, 'stale', 'Sort is the person\'s own and must survive a door');
  assert.deepEqual(h.calls, ['showTab:tasks']);
});

test('#3703: in the consolidated layout the door opens Tasks in the display column, not the tab view', () => {
  const h = harness({ consolidated: true });
  h.run('p1');
  assert.deepEqual(h.calls, ['openConsolidatedTasks']);
});

test('#3703: the scope a door sets survives the paint before the first read', () => {
  const fn = body('tskPaint');
  assert.match(fn, /if \(TSK\.data && TSK\.proj && !projMap\.has\(TSK\.proj\)\) TSK\.proj = null;/,
    'the scope can be dropped before any data is read, which loses the door\'s project');
  // CONTROL: the pre-fix line (no data guard) is a different line, so the match above can fail.
  assert.doesNotMatch('  if (TSK.proj && !projMap.has(TSK.proj)) TSK.proj = null;', /if \(TSK\.data && TSK\.proj/);
  assert.match(fn, /TSK\.projHint && TSK\.projHint\.id === TSK\.proj/, 'a door to a project with no tasks falls back to All tasks');
});

test('#1346 on the new destination: the count and the rows come from the same scoped array', () => {
  const fn = body('tskPaint');
  assert.match(fn, /const scoped = tskScoped\(all, TSK, now\);/);
  assert.match(fn, /const open = scoped\.filter\(\(t\) => t\.state !== 'closed'\);/);
  assert.match(fn, /getElementById\('tsk-sub'\)\.textContent = [\s\S]{0,80}open\.length/, 'the count is not taken from the scoped rows');
  assert.match(fn, /const shown = TSK\.tile \? scoped\.filter/, 'the rows are not taken from the same scoped array');
});

test('#1382 on the new destination: an unreadable read is said, and a row opens its task on its own project', () => {
  const load = body('tskLoad');
  assert.match(load, /TSK\.error = String\(body\.error \|\| 'we could not read your tasks just now'\)/);
  assert.match(load, /msg\.textContent = asSentence\(TSK\.error\)/, 'a failed read would render as an empty list');
  assert.match(body('tskOpenTask'), /tskGoToProject\(t\.projectId\)/, 'a row would open its task on the wrong project');
});

test('#3703: an archived project\'s own door still lists its tasks; no other archived project shows', () => {
  assert.match(body('tskLoad'), /'&withArchived=' \+ encodeURIComponent\(TSK\.proj\)/,
    'the read does not name the scoped project, so an archived project\'s door shows nothing');
  const tskVisible = new Function(body('tskVisible') + '\nreturn tskVisible;')();
  const rows = [
    { projectId: 'live', projectArchived: false },
    { projectId: 'arch', projectArchived: true },
    { projectId: 'other-arch', projectArchived: true },
  ];
  assert.deepEqual(tskVisible(rows, null).map((t) => t.projectId), ['live']);
  assert.deepEqual(tskVisible(rows, 'arch').map((t) => t.projectId), ['live', 'arch']);
  assert.deepEqual(tskVisible(null, 'arch'), []);
});

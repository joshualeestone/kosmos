'use strict';
/* kosmos#6481: on Tasks, a row leaves out its project line when every row in view is in one project (the line says
 * nothing then), and keeps it as soon as two projects are in view. On the REAL functions lifted from web/index.html:
 * the rule (tskRowsShareOneProject), the row (tskRow), and search (tskMatches), which must still find a task by its
 * project name with the line gone.
 *
 *   node --test web.tasks-one-project-6481.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
const { tskRowsShareOneProject, tskScoped } = new Function('LAST',
  page.liftAll(SCRIPT, ['tskRowsShareOneProject', 'tskAgentName', 'tskInWindow', 'tskMatches', 'tskScoped'])
  + '\nreturn { tskRowsShareOneProject, tskScoped };')([]);

const task = (number, projectId, projectName, sentence) => ({ number, projectId, projectName, projectPath: [], sentence,
  whoNames: [], state: 'nobody', createdAt: new Date().toISOString() });
const SPRING = [task(1, 'a', 'Launch the spring catalogue', 'Book the podcast tour'),
  task(2, 'a', 'Launch the spring catalogue', 'Order proof copies'),
  task(3, 'a', 'Launch the spring catalogue', 'Pick the launch date')];
const NEWS = task(7, 'b', 'Newsletter', 'Clean up bounced addresses');

test('#6481: one project in view shares one project; two projects do not', () => {
  assert.equal(tskRowsShareOneProject(SPRING), true);
  assert.equal(tskRowsShareOneProject(SPRING.concat([NEWS])), false, 'CONTROL: a second project keeps the line');
  assert.equal(tskRowsShareOneProject([NEWS]), true, 'a single row is one project too');
});

test('#6481: a task with no project counts as a project of its own, so the line stays beside it', () => {
  const loose = { ...SPRING[0], number: 9, projectId: null, projectName: '' };
  assert.equal(tskRowsShareOneProject(SPRING.concat([loose])), false, 'one project plus a task with no project');
  assert.equal(tskRowsShareOneProject([loose, { ...loose, number: 10 }]), false, 'only tasks with no project: nothing to name, so no change');
  assert.equal(tskRowsShareOneProject([{ ...loose, projectId: undefined }]), false);
});

test('#6481: an empty view (or no rows read yet) is not one project', () => {
  assert.equal(tskRowsShareOneProject([]), false);
  assert.equal(tskRowsShareOneProject(null), false);
});

test('#6481: the Project filter set to one project leaves one project in view; All projects keeps both', () => {
  const all = SPRING.concat([NEWS]);
  const st = { proj: null, win: 0, q: '' };
  assert.equal(tskRowsShareOneProject(tskScoped(all, st, Date.now())), false);
  assert.equal(tskRowsShareOneProject(tskScoped(all, { ...st, proj: 'b' }, Date.now())), true);
  assert.equal(tskRowsShareOneProject(tskScoped(all, { ...st, proj: 'a' }, Date.now())), true);
});

test('#6481: search by project name still finds the tasks, and the found set is one project', () => {
  const found = tskScoped(SPRING.concat([NEWS]), { proj: null, win: 0, q: 'spring catalogue' }, Date.now());
  assert.deepEqual(found.map((t) => t.number), [1, 2, 3]);
  assert.equal(tskRowsShareOneProject(found), true);
  assert.deepEqual(tskScoped(SPRING.concat([NEWS]), { proj: null, win: 0, q: 'newsletter' }, Date.now()).map((t) => t.number), [7]);
});

/* The row itself: the project line is drawn unless the view has one project; the Part of line stays either way. */
const rowWith = (oneProjectInView) => new Function('TSK', 'LAST', 'esc', 'agoWords', 'tskKey', 'claimNotReported', 'tskAgentName',
  'tskRepeatSentence', 'tskRepeatMissed', 'TSK_GROUPS',
  page.liftAll(SCRIPT, ['pjChainText', 'pjChainSpoken', 'tskChainOf', 'tskRow']) + '\nreturn tskRow;')(
  { sel: new Set(), by: 'status', fold: new Set(), oneProjectInView }, [], (s) => String(s), () => 'just now',
  (x) => x.projectId + '#' + x.number, () => '', (s) => s, () => '', () => false, []);

test('#6481: the row leaves out the project line when one project is in view, and draws it otherwise', () => {
  const t = SPRING[0];
  assert.match(rowWith(false)(t, { depth: 0, crumb: false, kids: 0 }), /data-open-project="a">Launch the spring catalogue<\/button>/,
    'CONTROL: two or more projects in view, the line is there');
  const one = rowWith(true)(t, { depth: 0, crumb: false, kids: 0 });
  assert.doesNotMatch(one, /data-open-project/);
  const meta = /<div class="meta">(.*?)<\/div>/.exec(one);
  assert.ok(meta, 'the rest of the meta line (added, due, subtasks) stays');
  assert.doesNotMatch(meta[1], /Launch the spring catalogue/);
  assert.match(meta[1], /added just now/);
  /* The checkbox still names the project for a screen reader, which hears one row at a time. */
  assert.match(one, /aria-label="Select task 1 of Launch the spring catalogue"/);
});

test('#6481: a subtask whose parent is not in view keeps its Part of line with one project in view', () => {
  const child = { ...SPRING[1], number: 4, parent: 1, parentSentence: 'Book the podcast tour' };
  const html = rowWith(true)(child, { depth: 0, crumb: true, kids: 0 });
  assert.match(html, /<span class="tsk-part">Part of #1 Book the podcast tour<\/span>/);
  assert.doesNotMatch(html, /data-open-project/);
});

/* Pins ORDER only, not behaviour: tskPaint needs the whole page DOM, so this reads its source. It holds that the title
   and the line decision read the view before the tile, and that both are settled before any row is drawn. */
test('#6481: the title and the line decide on the view before the tile, before any row is drawn (order only)', () => {
  const paint = page.lift(SCRIPT, 'tskPaint');
  const decide = paint.indexOf('TSK.oneProjectInView = tskLeaveOutProjectLine(scoped, picked);');
  const title = paint.indexOf('tskTitle(TSK.data, picked, scoped)');
  assert.ok(decide > -1 && title > -1, 'the line decision or the title does not read the view before the tile');
  assert.ok(decide > paint.indexOf('const scoped = tskScoped(all, TSK, now);'), 'decided before the view is scoped');
  /* The first tskList( on a line that is not a comment line; a call inside a string or after code on a line is not
     told apart, so this is the first such text, not a parsed call. */
  let firstRow = -1; let at = 0;
  for (const line of paint.split('\n')) {
    const lead = line.trimStart();
    if (!/^(\/\*|\*|\/\/)/.test(lead) && line.includes('tskList(')) { firstRow = at + line.indexOf('tskList('); break; }
    at += line.length + 1;
  }
  assert.ok(firstRow > -1, 'tskList( is not called in tskPaint');
  assert.ok(decide < firstRow && title < firstRow, 'order only: decided before the first non-comment line naming tskList(');
});

/* The title, and the line decision that goes with it. */
const { tskTitle, tskLeaveOutProjectLine } = new Function(page.liftAll(SCRIPT,
  ['tskRowsShareOneProject', 'pjChainText', 'tskChainOf', 'tskTitle', 'tskLeaveOutProjectLine'])
  + '\nreturn { tskTitle, tskLeaveOutProjectLine };')();
const as = (t, state) => ({ ...t, state });
const VIEW = [as(SPRING[0], 'nobody'), as(SPRING[1], 'working'), as(SPRING[2], 'closed'), as(NEWS, 'assigned')];
const ONE = VIEW.slice(0, 3);   // one project: two open, one closed
const SUB = [{ ...as(NEWS, 'assigned'), projectPath: ['Book A'], projectName: 'Launch' }];
const PICKED_SUB = { id: 'b', chain: ['Book A', 'Launch'] };

test('#6481: the title before a read, and on an empty read', () => {
  assert.equal(tskTitle(null, null, []), 'Tasks');
  assert.equal(tskTitle([], null, []), '0 Tasks');
  assert.equal(tskLeaveOutProjectLine([], null), false);
});

test('#6481: with the Project filter set the title names the leaf, as before (the crumb carries the path)', () => {
  assert.equal(tskTitle([], PICKED_SUB, SUB), '1 Task on Launch');
  assert.equal(tskTitle([], PICKED_SUB, []), '0 Tasks on Launch');
  assert.equal(tskLeaveOutProjectLine(SUB, PICKED_SUB), true);
});

test('#6481: with no filter and one project in view the title says "on" and the full path; two projects say how many', () => {
  assert.equal(tskTitle([], null, SUB), '1 Task on Book A \u203a Launch', 'unfiltered: the full path, no crumb gives context');
  assert.equal(tskTitle([], null, ONE), '2 Tasks on Launch the spring catalogue', 'a mix of open and closed counts the open ones');
  assert.equal(tskLeaveOutProjectLine(ONE, null), true);
  assert.equal(tskTitle([], null, VIEW), '3 Tasks on 2 Projects', 'CONTROL: two projects in view keep the count of projects');
  assert.equal(tskLeaveOutProjectLine(VIEW, null), false, 'CONTROL: two projects keep the line');
});

test('#6481: a count of 0 names no project, and then the rows keep their line', () => {
  const closedOnly = [as(SPRING[2], 'closed')];
  assert.equal(tskTitle([], null, closedOnly), '0 Tasks');
  assert.equal(tskLeaveOutProjectLine(closedOnly, null), false, 'nothing else names the project, so the line stays');
});

test('#6481: the title and the line decision take the view before the tile, and give its answer, not a tile subset', () => {
  /* No tile runs here: this checks that given the pre-tile view the two functions answer for it, even though a tile's
     subset (the Unassigned rows, all Spring catalogue) would be one project. That tskPaint passes the pre-tile view is
     pinned by the order test above and by the browser check. */
  const unassignedTileRows = VIEW.filter((t) => t.state === 'nobody');
  assert.equal(tskRowsShareOneProject(unassignedTileRows), true, 'the tile on its own would leave one project');
  assert.equal(tskTitle([], null, VIEW), '3 Tasks on 2 Projects');
  assert.equal(tskLeaveOutProjectLine(VIEW, null), false);
  // A picked project with the Completed tile: the title is still its open total, on its leaf.
  assert.equal(tskTitle([], { id: 'a', chain: ['Launch the spring catalogue'] }, ONE), '2 Tasks on Launch the spring catalogue');
});

test('#6481: open tasks all in one project plus a closed task in another keep the line, and the title names no project', () => {
  const closedElsewhere = as(NEWS, 'closed');
  const view = [as(SPRING[0], 'nobody'), as(SPRING[1], 'working'), closedElsewhere];
  assert.equal(tskLeaveOutProjectLine(view, null), false, 'a closed task in view is in view: two projects');
  assert.equal(tskTitle([], null, view), '2 Tasks on 1 Project');
  assert.equal(tskLeaveOutProjectLine(view.slice(0, 2), null), true, 'CONTROL: without the closed task, one project');
  assert.equal(tskTitle([], null, view.slice(0, 2)), '2 Tasks on Launch the spring catalogue', 'CONTROL');
});

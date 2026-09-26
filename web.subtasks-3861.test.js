'use strict';
/* #3861 part 2: subtasks on the screen. The nesting rule (taskNest, shared by the Tasks view and
 * the project column) and the Tasks row, lifted REAL from web/index.html, fed rows from the REAL
 * engine (allTasks for the Tasks view, joinTaskClaims for the project page), so a field the engine
 * stops sending fails here rather than rendering as a plain row.
 *
 *   node --test web.subtasks-3861.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-subtasks-web-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');
const tasks = require('./engine/tasks');
const projects = require('./engine/projects');
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const GROUPS = SCRIPT.match(/const TSK_GROUPS = \[[\s\S]*?\n\];/)[0];
const taskNest = new Function(page.liftAll(SCRIPT, ['taskNest']) + '\nreturn taskNest;')();
const tskKey = (t) => t.projectId + '#' + t.number;
const parentKey = (t) => (t.parent == null ? null : t.projectId + '#' + t.parent);

const p = projects.create({ name: 'Launch' });
tasks.create(p.id, { sentence: 'Plan the week' });                 // 1
tasks.create(p.id, { sentence: 'Book the venue', parent: 1 });     // 2
tasks.create(p.id, { sentence: 'Invitations', parent: 1 });        // 3
tasks.create(p.id, { sentence: 'Paper stock', parent: 3 });        // 4
tasks.create(p.id, { sentence: 'Order paper', parent: 4 });        // 5
tasks.create(p.id, { sentence: 'Loose task' });                    // 6
tasks.close(p.id, 2);
const rows = () => tasks.allTasks().filter((t) => t.projectId === p.id);

test('a family nests under its parent, two levels drawn, deeper ones at the second and named', () => {
  const out = taskNest(rows(), tskKey, parentKey, null);
  const at = Object.fromEntries(out.map((x) => [x.t.number, x]));
  assert.equal(at[1].depth, 0); assert.equal(at[1].kids, 2); assert.equal(at[1].crumb, false);
  assert.equal(at[3].depth, 1); assert.equal(at[3].crumb, false, 'the indent already says what 3 is part of');
  assert.equal(at[4].depth, 2); assert.equal(at[4].crumb, false);
  assert.equal(at[5].depth, 2); assert.equal(at[5].crumb, true, 'the third level is drawn at the second, so it must name its parent');
  assert.equal(at[6].depth, 0); assert.equal(at[6].crumb, false, 'a task that stands alone says nothing');
  // Every descendant follows its parent.
  const order = out.map((x) => x.t.number);
  for (const [child, parent] of [[2, 1], [3, 1], [4, 3], [5, 4]]) assert.ok(order.indexOf(child) > order.indexOf(parent), child + ' before its parent ' + parent);
});

test('a child whose parent is not in the list stays where the list put it and names its parent', () => {
  const open = rows().filter((t) => t.number !== 1);   // the parent filtered out (another group, a search)
  const out = taskNest(open, tskKey, parentKey, null);
  const at = Object.fromEntries(out.map((x) => [x.t.number, x]));
  assert.equal(at[3].depth, 0); assert.equal(at[3].crumb, true);
  assert.equal(at[2].depth, 0); assert.equal(at[2].crumb, true);
  assert.equal(out.length, open.length, 'no row is lost');
});

test('a folded parent leaves its whole family out, and only its family', () => {
  const out = taskNest(rows(), tskKey, parentKey, new Set([p.id + '#3']));
  const order = out.map((x) => x.t.number).sort();
  assert.deepEqual(order, [1, 2, 3, 6]);
  assert.equal(out.find((x) => x.t.number === 3).kids, 1, 'the folded parent still knows it has a subtask to show');
});

test('a row that is somehow never reached is still drawn (no loop can strand it)', () => {
  const a = { projectId: 'x', number: 1, parent: 2 };
  const b = { projectId: 'x', number: 2, parent: 1 };
  const out = taskNest([a, b], tskKey, parentKey, null);
  assert.equal(out.length, 2);
});

test('the project page rows carry the same tree facts as the Tasks view rows', () => {
  const joined = projects.joinTaskClaims(projects.readAll().find((x) => x.id === p.id).tasks, projects.readAll(), [], [], { name: 'Launch', id: p.id });
  const by = Object.fromEntries(joined.map((t) => [t.number, t]));
  const view = Object.fromEntries(rows().map((t) => [t.number, t]));
  for (const n of [1, 2, 3, 4, 5, 6]) {
    assert.equal(by[n].parent, view[n].parent, 'parent of ' + n);
    assert.equal(by[n].parentSentence, view[n].parentSentence, 'parentSentence of ' + n);
    assert.deepEqual(by[n].subtasks, view[n].subtasks, 'subtasks of ' + n);
  }
  assert.deepEqual(by[1].subtasks, { done: 1, total: 2 });
});

const rowHtml = (t, at, sel) => new Function('TSK', 'LAST', 'esc', 'agoWords', 'tskKey', 'claimNotReported', 'tskAgentName',
  GROUPS + '\n' + page.liftAll(SCRIPT, ['tskRow']) + '\nreturn tskRow;')(
  { sel: new Set(), by: 'status', fold: sel || new Set() }, [], (s) => String(s), () => 'just now', tskKey, () => '', (s) => s)(t, at);

test('a parent row carries its chip; with its family in the list the chip is the fold toggle', () => {
  const one = rows().find((t) => t.number === 1);
  const withKids = rowHtml(one, { depth: 0, crumb: false, kids: 2 });
  assert.match(withKids, /<button type="button" class="tsk-chip" data-fold="[^"]+#1" aria-expanded="true" aria-label="1 of 2 subtasks done\. Hide them"/);
  assert.match(withKids, />1\/2<\/button>/);
  const folded = rowHtml(one, { depth: 0, crumb: false, kids: 2 }, new Set([p.id + '#1']));
  assert.match(folded, /aria-expanded="false" aria-label="1 of 2 subtasks done\. Show them"/);
  const alone = rowHtml(one, { depth: 0, crumb: false, kids: 0 });
  assert.doesNotMatch(alone, /data-fold/);
  assert.match(alone, /<span class="tsk-chip" title="1 of 2 subtasks done">1\/2<span class="vh"> subtasks done<\/span><\/span>/);
  assert.doesNotMatch(alone, /<span[^>]*aria-label/, 'no aria-label on a plain span: the words are in the chip');
  assert.doesNotMatch(withKids, /all subtasks done/, 'one subtask is still open');
});

test('every subtask closed and the parent open: "all subtasks done" and Close it; a nested row is indented', () => {
  const q = projects.create({ name: 'Kit' });
  tasks.create(q.id, { sentence: 'Press kit' });
  tasks.create(q.id, { sentence: 'Logo', parent: 1 });
  tasks.close(q.id, 2);
  const kit = tasks.allTasks().filter((t) => t.projectId === q.id);
  const parent = Object.assign({}, kit.find((t) => t.number === 1), { state: 'nobody' });
  assert.match(rowHtml(parent, { depth: 0, crumb: false, kids: 0 }), /<span>all subtasks done<\/span><button type="button" data-close-parent="[^"]+#1">Close it<\/button>/);
  assert.doesNotMatch(rowHtml(Object.assign({}, parent, { state: 'closed' }), { depth: 0, crumb: false, kids: 0 }), /all subtasks done/, 'a closed parent is not offered Close');
  const child = kit.find((t) => t.number === 2);
  const crumbed = rowHtml(child, { depth: 1, crumb: true, kids: 0 });
  assert.match(crumbed, /class="tsk-row d1"/);
  assert.match(crumbed, /<span class="tsk-part">Part of #1 Press kit<\/span>/);
  assert.doesNotMatch(rowHtml(child, { depth: 1, crumb: false, kids: 0 }), /tsk-part/);
});

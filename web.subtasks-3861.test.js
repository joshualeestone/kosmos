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

/* #3898 (April's review of #3885): the new strings a person or an agent types (a task's sentence, its
   parent's sentence) reach innerHTML on four new paths. Each is fed markup-shaped text through the
   page's REAL esc(), lifted like everything else here, and must arrive as text, never as markup. The
   control runs the same path with an esc that passes text through, and must see the raw tag, so a
   path that stopped reaching innerHTML at all cannot pass by accident. */
const ESC = new Function(page.liftAll(SCRIPT, ['esc']) + '\nreturn esc;')();
const EVIL = '<img src=x onerror=alert(1)>';
const rawTag = /<img src=x onerror/;
const escapedTag = /&lt;img src=x onerror=alert\(1\)&gt;/;
const PASS = (s) => String(s);

const evilRows = () => {
  const q = projects.create({ name: 'Escapes' });
  tasks.create(q.id, { sentence: EVIL });                       // 1, the parent
  tasks.create(q.id, { sentence: 'child ' + EVIL, parent: 1 }); // 2
  return { q, rows: tasks.allTasks().filter((t) => t.projectId === q.id) };
};
const W1 = evilRows();

const tskRowWith = (escFn, t, at) => new Function('TSK', 'LAST', 'esc', 'agoWords', 'tskKey', 'claimNotReported', 'tskAgentName',
  GROUPS + '\n' + page.liftAll(SCRIPT, ['tskRow']) + '\nreturn tskRow;')(
  { sel: new Set(), by: 'status', fold: new Set() }, [], escFn, () => 'just now', tskKey, () => '', (s) => s)(t, at);

test('#3898: the Tasks view row escapes the sentence and the parent\'s sentence in its crumb', () => {
  const child = W1.rows.find((t) => t.number === 2);
  assert.equal(child.parentSentence, EVIL, 'PRE-CONTROL: the engine hands the parent\'s sentence to the row');
  const html = tskRowWith(ESC, child, { depth: 0, crumb: true, kids: 0 });
  assert.doesNotMatch(html, rawTag);
  assert.match(html, /<span class="tsk-part">Part of #1 &lt;img src=x onerror=alert\(1\)&gt;<\/span>/);
  assert.match(tskRowWith(PASS, child, { depth: 0, crumb: true, kids: 0 }), rawTag, 'CONTROL: without esc the raw tag reaches the row');
});

function paintColumn(escFn, project) {
  const els = { 'pj-tasklist': { innerHTML: '' }, 'pj-alltasks': { hidden: true, textContent: '' } };
  const src = [page.liftAll(SCRIPT, ['tkFace', 'tkSayPart', 'claimNotReported', 'taskClaimHtml', 'tkMemberName', 'taskNest', 'paintProjectTasks']),
    'let TK_LIST_HTML = null;'].join('\n');
  new Function('document', 'esc', 'discTint', 'discInk', 'initials', 'project', src + '\n; paintProjectTasks(project);')(
    { getElementById: (id) => els[id] || null }, escFn, () => '#dfe5ea', () => '#4a5560', (n) => String(n).slice(0, 2), project);
  return els['pj-tasklist'].innerHTML;
}
const joinedEvil = () => {
  const rec = projects.readAll().find((x) => x.id === W1.q.id);
  return { ...rec, tasks: projects.joinTaskClaims(rec.tasks, projects.readAll(), [], [], { name: rec.name, id: rec.id }) };
};

test('#3898: the project column escapes a card\'s sentence and its "Part of" crumb', () => {
  const ep = joinedEvil();
  // Only the child in the column, so its parent is "not in the list" and the crumb must show.
  const onlyChild = { ...ep, tasks: ep.tasks.filter((t) => t.number === 2) };
  const html = paintColumn(ESC, onlyChild);
  assert.match(html, /tkcard-part-of/, 'PRE-CONTROL: the crumb is drawn at all');
  assert.doesNotMatch(html, rawTag);
  assert.match(html, /<span class="tkcard-part-of">Part of #1 &lt;img src=x onerror=alert\(1\)&gt;<\/span>/, 'the crumb carries the parent\'s sentence, escaped');
  assert.match(paintColumn(PASS, onlyChild), rawTag, 'CONTROL: without esc the raw tag reaches the column');
});

function paintSubs(escFn, project, parentNumber) {
  const els = { 'tk-subs': { innerHTML: '' }, 'tk-subs-done': { hidden: true }, 'tk-partof-row': { hidden: true }, 'tk-partof': { textContent: '', dataset: {} } };
  const t = project.tasks.find((x) => x.number === parentNumber);
  new Function('document', 'esc', 'p', 't', page.liftAll(SCRIPT, ['tkPaintSubtasks']) + '\n; tkPaintSubtasks(p, t, false);')(
    { getElementById: (id) => els[id] || null }, escFn, project, t);
  return els;
}

test('#3898: the task page escapes each subtask\'s sentence, and names its parent as text', () => {
  const ep = joinedEvil();
  const parentPage = paintSubs(ESC, ep, 1);
  assert.match(parentPage['tk-subs'].innerHTML, /data-sub="2"/, 'PRE-CONTROL: the subtask is listed');
  assert.doesNotMatch(parentPage['tk-subs'].innerHTML, rawTag);
  assert.match(parentPage['tk-subs'].innerHTML, /child &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(paintSubs(PASS, ep, 1)['tk-subs'].innerHTML, rawTag, 'CONTROL: without esc the raw tag reaches the list');
  // The Part of line is textContent, so the parent's sentence is text by construction.
  const childPage = paintSubs(ESC, ep, 2);
  assert.equal(childPage['tk-partof'].textContent, '#1 ' + EVIL);
  assert.equal(childPage['tk-partof-row'].hidden, false);
});

function fillParents(escFn, project) {
  const sel = { value: '', innerHTML: '', selectedIndex: 0, dataset: {} };
  new Function('document', 'esc', 'NT_PARENT', 'p', page.liftAll(SCRIPT, ['ntFillParents']) + '\n; ntFillParents(p, false);')(
    { getElementById: (id) => (id === 'nt-parent' ? sel : null) }, escFn, null, project);
  return sel.innerHTML;
}

test('#3898: New task\'s "Part of" picker escapes each open task\'s sentence', () => {
  const ep = joinedEvil();
  const html = fillParents(ESC, ep);
  assert.match(html, /<option value="1">/, 'PRE-CONTROL: the open task is offered');
  assert.doesNotMatch(html, rawTag);
  assert.match(html, escapedTag);
  assert.match(fillParents(PASS, ep), rawTag, 'CONTROL: without esc the raw tag reaches the picker');
});

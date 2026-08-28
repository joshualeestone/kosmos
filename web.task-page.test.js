'use strict';

/**
 * The task page (#206).
 *
 * 🛑 THE MODAL IT REPLACED HAD NO TEST OF ANY KIND. Nothing in this suite
 * mentioned `tk-done`, `tk-title` or `openTaskModal`, so every claim it made
 * about a task was unpinned for as long as it existed. That is the reason this
 * file leads with the two things a page must do that a dialog did not have to:
 * stay TRUE while the poll runs under it, and go somewhere sensible when the
 * thing it is showing disappears.
 *
 * ⚠️ AND IT IS NOT THE WHOLE PROOF. These run the page's real functions against
 * a stub DOM; they cannot see rendering, which is precisely the class of defect
 * that has bitten this file before (a fully transparent modal passed 316 tests).
 * The rendering half is a headed browser pass, recorded in the PR.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

/* 🛑 SANDBOX BOTH ROOTS BEFORE REQUIRING ANYTHING THAT READS THEM. The first
   version of this file did not, and `yarn test` runs every file in ONE
   process: the project name collided with another suite's, `create` threw
   "that folder is already the project ...", and eleven tests that pass alone
   failed together. Un-sandboxed roots also point at the real app data of
   whoever runs the suite, which is the worse half of the same mistake. */
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-tkpage-'));
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-tkpage-data-'));

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

/* The brace matcher, boundary-anchored for the reason server.test.js records:
   a new sibling whose name starts with the wanted one silently captures it. */
function fnSource(name) {
  let start = SCRIPT.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' vanished from the page');
  let depth = 0; let end = -1;
  for (let k = SCRIPT.indexOf('{', start); k < SCRIPT.length; k += 1) {
    if (SCRIPT[k] === '{') depth += 1;
    else if (SCRIPT[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  assert.ok(end > -1, 'could not find the end of ' + name);
  return SCRIPT.slice(start, end);
}

/* A DOM stub thin enough to read, honest about the two things these tests
   assert on: textContent and hidden. */
function stubDoc(ids) {
  const els = {};
  for (const id of ids) els[id] = { textContent: '', innerHTML: '', hidden: false, focus() {}, disabled: false };
  return {
    els,
    getElementById: (id) => els[id] || null,
    querySelector: () => null,
  };
}

const TK_IDS = ['tk-back', 'tk-num', 'tk-title', 'tk-detail', 'tk-project', 'tk-added',
  'tk-state', 'tk-who', 'tk-why', 'tk-note', 'tk-done', 'tk-msg', 'pj-task-view', 'pj-newtask'];

/**
 * Run the page's REAL paintTaskPage against the stub.
 *
 * ⚠️ `Date` is shimmed rather than the clock left alone, because "yesterday"
 * is the one claim on this page that depends on when the test runs. The shim
 * is a subclass so `new Date(iso)` still works and only the argless form moves.
 */
function runPaint({ task, project, now }) {
  const doc = stubDoc(TK_IDS);
  const views = [];
  const src = [fnSource('tkStateWord'), fnSource('tkAdded'), fnSource('tkFace'), fnSource('taskClaimHtml'),
    fnSource('paintTaskPage')].join('\n');
  const NOW = now || Date.now();
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return NOW; }
  }
  const proj = { ...project, tasks: [...(project.tasks || []), task] };
  new Function('document', 'pjById', 'PJ_CURRENT', 'TK_OPEN', 'pjView', 'esc',
    'discTint', 'discInk', 'initials', 'tkMemberName', 'Date',
    src + '\n; paintTaskPage();')(
    doc, () => proj, proj.id, task.number, (v) => views.push(v),
    (x) => String(x), () => '#dfe5ea', () => '#4a5560',
    (n) => String(n).slice(0, 2).toUpperCase(),
    (p, sn) => ((p.agents || []).find((a) => a.sessionName === sn) || {}).name || sn,
    FixedDate);
  return { doc, views };
}

/**
 * The project roster row comes from the REAL producer, not from a literal.
 *
 * 🔑 fixture-discipline.test.js caught the literal I wrote first, and it was
 * right to: this page reads `hasAvatar` off a member, and a hand-built row is
 * free to carry a field the producer never emits. `projects.describe()` is
 * what puts `hasAvatar` on these rows (engine/projects.js), so taking the row
 * from it is the only version of this fixture that can prove the branch is
 * reachable at all.
 */
const fleet = require('./test-support/fleet');
const projects = require('./engine/projects');

let PROJECT = null;
test.before(() => {
  const board = fleet.install([fleet.agent('april', { state: 'working' })]);
  try {
    const made = projects.create({ name: 'Customer Onboarding Refresh' });
    projects.addAgent(made.id, 'april');
    PROJECT = projects.describe(projects.readAll().find((x) => x.id === made.id), board.agents);
    assert.ok(PROJECT.agents.length === 1 && 'hasAvatar' in PROJECT.agents[0],
      'the premise: the roster row this page reads really does carry hasAvatar');
  } finally { board.restore(); }
});

test('the page says which task, in which project, added when, and in what state', () => {
  const now = new Date('2026-08-22T12:00:00Z').getTime();
  const { doc } = runPaint({
    project: { ...PROJECT, tasks: [] },
    task: { number: 15, sentence: 'Rewrite the handoff checklist', detail: null, who: null,
      createdAt: new Date(now - 86400000 * 1).toISOString(), addedBy: 'operator', closedAt: null },
    now,
  });
  assert.equal(doc.els['tk-num'].textContent, 'Task 15');
  assert.equal(doc.els['tk-title'].textContent, 'Rewrite the handoff checklist');
  assert.equal(doc.els['tk-project'].textContent, 'Customer Onboarding Refresh');
  assert.equal(doc.els['tk-state'].textContent, 'Open');
  assert.equal(doc.els['tk-done'].textContent, 'Mark as done');
  // The back link IS the breadcrumb: the way back and what it belongs to are
  // the same fact, so the project name has to be in it.
  assert.match(doc.els['tk-back'].textContent, /Customer Onboarding Refresh/);
});

test('"Added" is whole days apart, not twenty-four-hour arithmetic', () => {
  /* ⚠️ BUILT FROM LOCAL COMPONENTS, NOT A Z-STAMP. The first version of this
     fixture said 00:30Z, which in the machine's own timezone was half past
     seven the previous EVENING -- so "three hours earlier" was the same
     afternoon and the test failed for a reason that had nothing to do with the
     code. The claim being pinned is about the calendar the person is looking
     at, so the fixture has to be expressed in it. */
  const now = new Date(2026, 7, 22, 0, 30).getTime();   // 00:30 local, whatever local is
  const mk = (createdAt) => runPaint({
    project: { ...PROJECT, tasks: [] },
    task: { number: 1, sentence: 's', who: null, createdAt, addedBy: 'operator', closedAt: null },
    now,
  }).doc.els['tk-added'].textContent;

  /* 🔑 THE TRAP THIS PINS: a task made three hours ago, across midnight, is
     "yesterday" to a person and "today" to a subtraction. Both readings are
     defensible in the abstract and only one matches the word on the screen. */
  const threeHoursAgo = new Date(now - 3 * 3600 * 1000).toISOString();
  assert.equal(mk(threeHoursAgo), 'You, yesterday');
  assert.equal(mk(new Date(now + 60 * 1000).toISOString()), 'You, today');
});

test('a closed task shows Done and offers the undo, not the act again', () => {
  const { doc } = runPaint({
    project: { ...PROJECT, tasks: [] },
    task: { number: 2, sentence: 's', who: 'april', createdAt: new Date().toISOString(),
      addedBy: 'operator', closedAt: new Date().toISOString() },
  });
  assert.equal(doc.els['tk-state'].textContent, 'Done');
  assert.equal(doc.els['tk-done'].textContent, 'Reopen');
  // ⚠️ And the close-note is GONE, because it warns about stopping somebody
  // and there is nothing left to stop: it belongs to an open, assigned task.
  assert.equal(doc.els['tk-note'].hidden, true);
});

test('the close-note says what closing does NOT do, whenever somebody is on it', () => {
  const { doc } = runPaint({
    project: { ...PROJECT, tasks: [] },
    task: { number: 3, sentence: 's', who: 'april', createdAt: new Date().toISOString(),
      addedBy: 'operator', closedAt: null },
  });
  assert.equal(doc.els['tk-note'].hidden, false);
  /* 🛑 THE WORST LIE THIS APP COULD TELL is that closing a task stops the
     agent, because the person would stop watching something still running.
     Nothing in Kosmos can reach into a session. */
  assert.match(doc.els['tk-note'].textContent, /does not stop April/);
});

test('nobody on it SAYS so rather than rendering as nothing', () => {
  const { doc } = runPaint({
    project: { ...PROJECT, tasks: [] },
    task: { number: 4, sentence: 's', who: null, createdAt: new Date().toISOString(),
      addedBy: 'operator', closedAt: null },
  });
  assert.match(doc.els['tk-who'].innerHTML, /Nobody yet/);
  /* A state that renders as nothing is indistinguishable from a feature
     nobody built -- the finding behind the task cards' four appearances. */
});

test('the unknown claim gets its reason on the page, where there is room for it', () => {
  const { doc } = runPaint({
    project: { ...PROJECT, tasks: [] },
    task: {
      number: 5, sentence: 's', who: 'april', createdAt: new Date().toISOString(),
      addedBy: 'operator', closedAt: null,
      claim: { claimed: null, because: 'we cannot tie the pane holding this name to the agent' },
    },
  });
  assert.equal(doc.els['tk-why'].hidden, false);
  assert.match(doc.els['tk-why'].textContent, /could not check whether April/);
  // true and false are complete statements and have no because to give.
  const settled = runPaint({
    project: { ...PROJECT, tasks: [] },
    task: {
      number: 6, sentence: 's', who: 'april', createdAt: new Date().toISOString(),
      addedBy: 'operator', closedAt: null, claim: { claimed: true },
    },
  });
  assert.equal(settled.doc.els['tk-why'].hidden, true);
});

test('a task that disappears under the open page sends you to its project', () => {
  const doc = stubDoc(TK_IDS);
  const views = [];
  const src = [fnSource('tkStateWord'), fnSource('tkAdded'), fnSource('tkFace'), fnSource('taskClaimHtml'),
    fnSource('paintTaskPage')].join('\n');
  new Function('document', 'pjById', 'PJ_CURRENT', 'TK_OPEN', 'pjView', 'esc',
    'discTint', 'discInk', 'initials', 'tkMemberName', src + '\n; paintTaskPage();')(
    doc, () => ({ ...PROJECT, tasks: [] }), 'p1', 99, (v) => views.push(v),
    String, () => '#eee', () => '#333', String, (p, s) => s);
  /* 🔑 A DIALOG COULD JUST BE DISMISSED. A page has to go somewhere, and the
     project it belonged to is the only honest destination -- staying put would
     leave a screen describing a task that is not there. */
  assert.deepEqual(views, ['one']);
});

test('the page is a page: no Escape handler and no focus trap on it', () => {
  /* ⚠️ THESE TWO ARE WHAT MADE THE OLD ONE A MODAL, and leaving either behind
     would be the dialog behaviour surviving the markup that stopped being one.
     A trap on a page stops the keyboard reaching the tab bar. */
  assert.equal(SCRIPT.includes("['tk-modal'"), false, 'the focus trap still lists the task surface');
  assert.equal(SCRIPT.includes('closeTaskModal'), false, 'the dialog closer is still wired');
  assert.equal(PAGE.includes('id="tk-modal"'), false, 'the dialog markup is still in the page');
  /* #383 finished what #206 started: creation is a page too, so the trap
     and the Escape are gone for BOTH task surfaces, on purpose. The old
     control here asserted the modal KEPT them, which was right while it
     was a modal and is the regression direction now. */
  /* #766 (Josh, 2026-08-24 22:09) reversed #383 for the NEW-task half only:
     it is a dialog again, because the page "has so much empty space". The
     task page itself stays a page (no Escape, no trap). */
  assert.ok(PAGE.includes('id="nt-modal"'), 'the new-task dialog is gone');
  assert.equal(PAGE.includes('id="pj-newtask-view"'), false, 'the new-task page is still in the markup beside the dialog');
  assert.match(SCRIPT, /if \(!document\.getElementById\('nt-modal'\)\.hidden\) leaveNewTask\(\);/, 'Escape does not leave the dialog');
  assert.ok(SCRIPT.includes('leaveNewTask'), 'the dialog has no leave, so Cancel is dead');
  assert.doesNotMatch(SCRIPT, /getElementById\('nt-back'\)\.textContent = /, 'the dialog\'s Cancel is relabelled with the project\'s name (the old page\'s Back)');
  assert.match(PAGE, /<button class="btn" id="nt-back" type="button">Cancel<\/button>/);
});

test('the poll repaints the task page, not only the project under it', () => {
  /* 🛑 THE COST OF MISSING THIS is a page holding a "Mark as done" button for
     a task somebody closed elsewhere. A dialog could be stale for as long as
     it was up; a page cannot. Guarded on the view being visible so a stale
     open number cannot repaint a screen nobody is looking at. */
  assert.match(SCRIPT, /TK_OPEN !== null && !document\.getElementById\('pj-task-view'\)\.hidden\) paintTaskPage\(\)/);
});

test('the view is one of the project views, so opening it puts the others away', () => {
  /* 🛑 NOT THE EXACT MEMBERSHIP LIST. This pinned all six names, so ADDING a
     legitimate view broke it: #1382 added `alltasks` and this went red on
     correct code. The claim #766 is making is that NEWTASK IS NOT A VIEW, and
     that survives the list growing.
     ⇒ Loosen on the axis nothing consumes (which views exist), tighten on the
     axis the test promises (newtask is not among them, and task is). */
  const loop = SCRIPT.match(/for \(const v of \['list', 'one',([^\]]*)\]\)/);
  assert.ok(loop, 'the project-view loop is gone or no longer starts at list, one');
  const views = loop[0].replace(/^[^[]*\[|\]\)$/g, '').split(',').map((x) => x.trim().replace(/'/g, ''));
  assert.ok(views.includes('task'), 'the task page is no longer one of the project views');
  assert.ok(views.includes('docs'), 'the documents screen is no longer one of the project views');
  assert.ok(!views.includes('newtask'), 'newtask is a dialog, not a view (#766)');
});

test('the new-task page keeps typed words across Back, and never across projects (#383)', () => {
  /* The modal's never-delete rule survives the surface change with a
     sharper edge: Back parks the draft (NT_FOR remembers whose it is),
     reopening for the SAME project keeps it, and a DIFFERENT project
     starts clean, so a half-written task cannot be filed under the wrong
     project. Source pins, because the property is a pair of branches. */
  assert.match(SCRIPT, /if \(!sameDraft\)/,
    'the draft is no longer keyed to its project, so it leaks across projects or dies on Back');
  assert.match(SCRIPT, /NT_FOR = null;\s*\n\s*document\.getElementById\('nt-what'\)\.value = '';/,
    'a created task does not clear the draft, so the next open shows the last task again');
  /* The assignee is part of the draft: the select rebuild resets it, so it
     is carried for the same project's draft and restored only when the
     option survived the rebuild. */
  assert.match(SCRIPT, /const sameDraft = NT_FOR === p\.id;/,
    'the kept-draft decision is not taken before the key moves, so a clean open resurrects the previous assignee');
  assert.match(SCRIPT, /const keepWho = sameDraft \? sel\.value : '';/,
    'the chosen assignee dies on Back, so a checked-something-and-returned person files to Nobody');
  assert.match(SCRIPT, /sel\.value = keepWho;/,
    'the carried assignee is never restored after the rebuild');
  assert.match(SCRIPT, /if \(sel\.selectedIndex === -1\) sel\.selectedIndex = 0;/,
    'a departed member leaves the select blank instead of resting on Nobody');
});

test('there is no due date field, and that is a decision rather than an omission', () => {
  /* Nothing in Kosmos acts on a date: agents are not scheduled and nothing
     reminds anybody, so a date would be a promise printed on a screen. The
     comment saying so is the thing that stops it being re-added as an
     oversight, which is why the test pins the comment and not just the
     absence. */
  const view = PAGE.slice(PAGE.indexOf('<div id="pj-task-view"'), PAGE.indexOf('<div id="pj-settings-view"'));
  assert.equal(/due/i.test(view.replace(/<!--[\s\S]*?-->/g, '')), false, 'a due date appeared on the task page');
  assert.match(view, /NO DUE DATE FIELD/);
});

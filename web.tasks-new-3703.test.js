'use strict';
/* #3703: "+ New task" from the Tasks view, on the REAL dialog functions lifted from web/index.html
 * (openNewTask, ntAimAt, ntChoices, leaveNewTask) run against a stub DOM.
 *
 *   node --test web.tasks-new-3703.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const FNS = page.liftAll(SCRIPT, ['pjById', 'ntChoices', 'openNewTask', 'ntAimAt', 'leaveNewTask']);

function world(projects, { current = null } = {}) {
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, hidden: false, value: '', textContent: '', innerHTML: '', disabled: false, selectedIndex: 0, focused: 0, focus() { this.focused += 1; focusLog.push(id); } });
  const focusLog = [];
  for (const id of ['nt-projrow', 'nt-proj', 'nt-in', 'nt-project', 'nt-what', 'nt-detail', 'nt-who', 'nt-msg', 'nt-go', 'nt-modal', 'nt-back', 'tsk-new', 'pj-newtask']) el(id);
  els['nt-projrow'].hidden = true;
  els['nt-modal'].hidden = true;
  const document = { getElementById: (id) => els[id] || null };
  const esc = (s) => String(s);
  const api = new Function('document', 'PROJECTS', 'PJ_CURRENT', 'esc',
    'let NT_FOR = null; let NT_ORIGIN = "project"; let NT_PROJECT = null;\n' + FNS
    + '\nreturn { openNewTask, leaveNewTask, ntChoices, get NT_PROJECT() { return NT_PROJECT; }, get NT_ORIGIN() { return NT_ORIGIN; }, set NT_FOR(v) { NT_FOR = v; } };')(
    document, projects, current, esc);
  return { api, els, focusLog };
}

const P = [
  { id: 'b', name: 'Newsletter', agents: [{ sessionName: 'rex', name: 'Rex' }] },
  { id: 'a', name: 'Spring launch', agents: [{ sessionName: 'ada', name: 'Ada', role: 'writer' }] },
  { id: 'z', name: 'Old stuff', archived: true, agents: [] },
];

test('a project picked in the Tasks view: the dialog is for that project, no picker', () => {
  const w = world(P);
  w.api.openNewTask('a', 'tasks');
  assert.equal(w.api.NT_PROJECT, 'a');
  assert.equal(w.els['nt-project'].textContent, 'Spring launch');
  assert.equal(w.els['nt-projrow'].hidden, true);
  assert.equal(w.els['nt-in'].hidden, false);
  assert.match(w.els['nt-who'].innerHTML, /value="ada"/, 'the members offered are not that project\'s');
  assert.equal(w.els['nt-modal'].hidden, false);
});

test('All tasks: the dialog asks which project, lists only live projects by name, and aims at the first', () => {
  const w = world(P);
  w.api.openNewTask(null, 'tasks');
  assert.equal(w.els['nt-projrow'].hidden, false, 'no project picker');
  assert.equal(w.els['nt-in'].hidden, true, 'the "In <project>." line shows beside the picker');
  const opts = [...w.els['nt-proj'].innerHTML.matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(opts, ['b', 'a'], 'the picker is not the live projects by name (archived set aside)');
  assert.equal(w.api.NT_PROJECT, 'b');
  assert.match(w.els['nt-who'].innerHTML, /value="rex"/);
  assert.doesNotMatch(w.els['nt-who'].innerHTML, /value="ada"/, 'another project\'s members are offered');
});

test('no projects at all: the dialog says to make one, and Create stays down', () => {
  const w = world([{ id: 'z', name: 'Old', archived: true }]);
  w.api.openNewTask(null, 'tasks');
  assert.equal(w.api.NT_PROJECT, null);
  assert.match(w.els['nt-msg'].textContent, /Make a project first/);
  assert.equal(w.els['nt-go'].disabled, true);
  assert.equal(w.els['nt-modal'].hidden, false);
  assert.deepEqual(w.focusLog, ['nt-back'], 'focus is not on the way out');
  // The Create gate on typing also refuses without a project.
  assert.match(SCRIPT, /getElementById\('nt-go'\)\.disabled = !document\.getElementById\('nt-what'\)\.value\.trim\(\) \|\| !NT_PROJECT;/);
});

test('from the project page nothing changes: its own project, no picker, focus back to its button', () => {
  const w = world(P, { current: 'a' });
  w.api.openNewTask();
  assert.equal(w.api.NT_ORIGIN, 'project');
  assert.equal(w.api.NT_PROJECT, 'a');
  assert.equal(w.els['nt-projrow'].hidden, true);
  w.api.leaveNewTask();
  assert.equal(w.focusLog[w.focusLog.length - 1], 'pj-newtask');
  // The button's listener is wrapped, so the click Event is never read as a project id.
  assert.match(SCRIPT, /getElementById\('pj-newtask'\)\.addEventListener\('click', \(\) => openNewTask\(\)\);/);
  assert.doesNotMatch(SCRIPT, /getElementById\('pj-newtask'\)\.addEventListener\('click', openNewTask\);/);
});

test('from the Tasks view, leaving returns focus to "+ New task"', () => {
  const w = world(P);
  w.api.openNewTask('a', 'tasks');
  w.api.leaveNewTask();
  assert.equal(w.focusLog[w.focusLog.length - 1], 'tsk-new');
});

test('the create path files to the dialog\'s project and, from Tasks, answers in the Tasks view', () => {
  const at = SCRIPT.indexOf("getElementById('nt-go').addEventListener('click'");
  const fn = SCRIPT.slice(at, SCRIPT.indexOf('\n});\n', at) + 5);
  assert.match(fn, /const p = pjById\(NT_PROJECT\);/, 'Create files to PJ_CURRENT, not the project the dialog shows');
  assert.match(fn, /if \(NT_ORIGIN === 'tasks'\) \{[\s\S]*'Added task '[\s\S]*await tskLoad\(false\);[\s\S]*return;\s*\}\s*await pjReload\(\);/,
    'from Tasks the answer does not land in the Tasks view, or the project page path changed');
});

test('the Tasks head carries "+ New task" as its primary button', () => {
  assert.match(PAGE, /<div class="tsk-head"><h2 id="tsk-title">All tasks<\/h2><button class="btn uprime" id="tsk-new" type="button">/);
  assert.match(SCRIPT, /getElementById\('tsk-new'\)\.addEventListener\('click', openNewTaskFromTasks\)/);
});

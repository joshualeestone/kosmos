'use strict';
/* #3703: "+ New task" from the Tasks view, on the REAL dialog functions lifted from web/index.html
 * (openNewTask, ntAimAt, ntChoices, leaveNewTask) run against a stub DOM.
 *
 *   node --test web.tasks-new-3703.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// The members are REAL board cards (fixture-discipline): sandbox the roots before requiring the fleet.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tasksnew-page-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');
const fleet = require('./test-support/fleet');
const BOARD = fleet.install([fleet.agent('rex'), fleet.agent('ada')]);
const card = (name) => BOARD.agents.find((c) => c.sessionName === name);
test.after(() => { try { BOARD.restore(); } catch { /* restored */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const FNS = page.liftAll(SCRIPT, ['pjById', 'ntChoices', 'openNewTask', 'ntAimAt', 'leaveNewTask']);

function world(projects, { current = null, readFailed = false } = {}) {
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, hidden: false, value: '', textContent: '', innerHTML: '', disabled: false, selectedIndex: 0, focused: 0, focus() { this.focused += 1; focusLog.push(id); } });
  const focusLog = [];
  for (const id of ['nt-projrow', 'nt-proj', 'nt-in', 'nt-project', 'nt-what', 'nt-detail', 'nt-who', 'nt-msg', 'nt-go', 'nt-modal', 'nt-back', 'tsk-new', 'pj-newtask']) el(id);
  els['nt-projrow'].hidden = true;
  els['nt-modal'].hidden = true;
  const document = { getElementById: (id) => els[id] || null };
  const esc = (s) => String(s);
  const api = new Function('document', 'PROJECTS', 'PJ_CURRENT', 'PJ_READ_FAILED', 'esc',
    'let NT_FOR = null; let NT_ORIGIN = "project"; let NT_PROJECT = null;\n' + FNS
    + '\nreturn { openNewTask, leaveNewTask, ntChoices, get NT_PROJECT() { return NT_PROJECT; }, get NT_ORIGIN() { return NT_ORIGIN; }, set NT_FOR(v) { NT_FOR = v; } };')(
    document, projects, current, readFailed, esc);
  return { api, els, focusLog };
}

const P = [
  { id: 'b', name: 'Newsletter', agents: [card('rex')] },
  { id: 'a', name: 'Spring launch', agents: [card('ada')] },
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
  const w = world([]);
  w.api.openNewTask(null, 'tasks');
  assert.equal(w.api.NT_PROJECT, null);
  assert.match(w.els['nt-msg'].textContent, /Make a project first/);
  assert.equal(w.els['nt-go'].disabled, true);
  assert.equal(w.els['nt-modal'].hidden, false);
  assert.deepEqual(w.focusLog, ['nt-back'], 'focus is not on the way out');
  // The Create gate on typing also refuses without a project.
  assert.match(SCRIPT, /getElementById\('nt-go'\)\.disabled = !document\.getElementById\('nt-what'\)\.value\.trim\(\) \|\| !NT_PROJECT;/);
});

test('an unreadable project list is said as unreadable, never as "make a project first"', () => {
  const w = world([], { readFailed: true });
  w.api.openNewTask(null, 'tasks');
  assert.match(w.els['nt-msg'].textContent, /could not read your projects/);
  assert.doesNotMatch(w.els['nt-msg'].textContent, /Make a project first/);
  assert.equal(w.els['nt-go'].disabled, true);
});

test('projects that are all archived are not "no projects"', () => {
  const w = world([{ id: 'z', name: 'Old', archived: true, agents: [] }]);
  w.els['nt-project'].textContent = 'Stale name';
  w.api.openNewTask(null, 'tasks');
  assert.match(w.els['nt-msg'].textContent, /Every project is archived/);
  assert.equal(w.els['nt-project'].textContent, '', 'the hidden describedby line still names an old project');
});

test('the picker offers a kept draft\'s project only when the draft has words in it', () => {
  const w = world(P, { current: 'a' });
  w.api.openNewTask();              // opened on Spring launch's page, nothing typed
  w.api.leaveNewTask();
  w.api.openNewTask(null, 'tasks');
  assert.equal(w.els['nt-proj'].value, 'b', 'an empty open steered the picker away from the first by name');
  w.api.leaveNewTask();
  w.api.openNewTask();              // Spring launch again, and this time something is typed
  w.els['nt-what'].value = 'Draft for Spring';
  w.api.leaveNewTask();
  w.api.openNewTask(null, 'tasks');
  assert.equal(w.els['nt-proj'].value, 'a', 'a real draft is not offered its own project');
});

test('changing the project in the dialog keeps the words and resets who is on it', () => {
  const at = SCRIPT.indexOf("getElementById('nt-proj').addEventListener('change'");
  const fn = SCRIPT.slice(at, SCRIPT.indexOf('\n});\n', at) + 5);
  assert.ok(at > -1, 'the picker handler moved; update this test');
  assert.match(fn, /NT_FOR = p\.id;[\s\S]*getElementById\('nt-who'\)\.value = '';[\s\S]*ntAimAt\(p\);/,
    'an agent picked for one project is carried to another, or the words are cleared');
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

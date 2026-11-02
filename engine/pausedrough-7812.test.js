'use strict';
/* kosmos#7812 (feedback 11-02): three rough edges around paused projects.
 *   1. a paused project's task does not read "decision" (Needs your decision), as the project page already hides it (#6341);
 *   2. a resume types each member one line, so it does not wait for its next idle check;
 *   3. the role command's help states the 60-character limit, from the same constant the command enforces.
 *
 *   node --test engine/pausedrough-7812.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-pausedrough-7812-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const chat = require('./chat');
const messages = require('./messages');
const tasks = require('./tasks');
const projects = require('./projects');
const fleet = require('../test-support/fleet');

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

/* --- 1. taskState --------------------------------------------------------------------------------------------------- */
const open = (extra = {}) => ({ n: 1, text: 'a task', parts: [{ who: 'casey' }], ...extra });

test('#7812 a task in a paused project whose agent needs the person reads held, not decision', () => {
  assert.equal(tasks.taskState(open({ waitingOnPerson: true })), 'decision', 'CONTROL: not paused, it is a decision');
  assert.equal(tasks.taskState(open({ waitingOnPerson: true, projectPaused: true })), 'held');
});

test('#7812 a hold for the person in a paused project reads held, not decision', () => {
  assert.equal(tasks.taskState(open({ onHold: true, onHoldForPerson: true })), 'decision', 'CONTROL: not paused, it is a decision');
  assert.equal(tasks.taskState(open({ onHold: true, onHoldForPerson: true, projectPaused: true })), 'held');
});

test('#7812 finished work in a paused project still reads built, even when its agent needs the person', () => {
  assert.equal(tasks.taskState(open({ waitingOnPerson: true, projectPaused: true, builtAt: '2026-11-02T10:00:00.000Z' })), 'built');
});

/* --- 2. tellResumed --------------------------------------------------------------------------------------------------- */
const IDLE = '⏺ Done.\n\n────────\n❯ \n────────\n  bypass permissions on (shift+tab to cycle)';
function arm() {
  const calls = [];
  chat.setRunner((args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: IDLE, err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  chat.setPauser(() => {});
  calls.text = () => calls.filter((a) => a[0] === 'set-buffer' || a[0] === 'send-keys').map((a) => a.join(' ')).join('\n');
  return calls;
}

test('#7812 a resume types each addressable member one line naming the project and how to see its tasks', () => {
  const board = fleet.install([fleet.agent('casey', { state: 'idle' }), fleet.agent('dana', { state: 'idle' })]);
  try {
    const calls = arm();
    const r = messages.tellResumed('p7812', 'Plans', ['casey', 'dana', 'gone'], board.agents);
    assert.equal(r.ok, true);
    assert.deepEqual(r.told.map((t) => t.to), ['casey', 'dana'], 'a member with no card was typed to, or one was missed');
    const line = messages.resumedLine('p7812', 'Plans');
    assert.equal(line, '[from Kosmos] Project Plans (p7812) was resumed: its tasks can be worked on and handed out again. See them with: kosmos task list p7812');
    assert.ok(calls.text().includes('was resumed'), 'nothing like the line reached tmux');
  } finally { chat.resetForTests(); board.restore(); }
});

test('#7812 a member switched off in the project is not woken by a resume', () => {
  const board = fleet.install([fleet.agent('casey', { state: 'idle' }), fleet.agent('dana', { state: 'idle' })]);
  const real = projects.swarmOffSet;
  projects.swarmOffSet = (id) => (id === 'p7812' ? new Set(['dana']) : new Set());
  try {
    arm();
    const r = messages.tellResumed('p7812', 'Plans', ['casey', 'dana'], board.agents);
    assert.deepEqual(r.told.map((t) => t.to), ['casey']);
  } finally { projects.swarmOffSet = real; chat.resetForTests(); board.restore(); }
});

test('#7812 a project id that is not a plain id is refused, and the name is shown only when it is plain', () => {
  assert.deepEqual(messages.tellResumed('../x', 'Plans', ['casey'], []), { ok: false, told: [] });
  assert.equal(messages.resumedLine('p1', 'Plans; rm -rf'), '[from Kosmos] Project p1 was resumed: its tasks can be worked on and handed out again. See them with: kosmos task list p1');
});

test('#7812 the edit route tells the members only on a resume of a project that was paused', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf('messages.tellResumed(');
  assert.ok(at > 0, 'server.js no longer tells the members on a resume');
  assert.equal(src.indexOf('messages.tellResumed(', at + 1), -1, 'a second caller: read it');
  assert.match(src.slice(Math.max(0, at - 200), at), /if \(fields\.paused === false && wasPaused === true && reRead && roster\) \{/);
  const edit = src.lastIndexOf('projects.edit(id, fields);', at);
  assert.ok(edit > 0 && at - edit < 4000, 'the tell is no longer after the edit in the same route');
});

/* --- 3. the help ------------------------------------------------------------------------------------------------------ */
test('#7812 both command-line helps state the role limit, from the constant the command enforces', () => {
  const want = projects.ROLE_HERE_MAX + ' characters at most';
  for (const f of ['install/kosmos', 'tools/windows/kosmos-cli.js']) {
    const line = fs.readFileSync(path.join(__dirname, '..', f), 'utf8').split('\n').find((l) => l.includes('kosmos project role <project-id>'));
    assert.ok(line, f + ' has no role help line');
    assert.ok(line.includes(want), f + ' does not say "' + want + '": ' + line.trim());
  }
});

'use strict';
/**
 * kosmos#5034: taking an agent off a project leaves nothing of it on that project.
 *
 * Before: the leave changed membership and nothing else, so (1) a needs_you or blocked report the agent had raised
 * about the project stayed, and kept that project's task cards in Needs Your Decision (removal does not unassign),
 * and (2) room posts held for the agent in that project were still told to it at its next idle.
 *
 * Every arm has a control that can return the dangerous answer: the card is a decision BEFORE the leave, a
 * question about another project is NOT cleared, an automatic permission wait is NOT cleared, another project's
 * held posts are KEPT, and the engine rule with no members is unchanged.
 *
 *   node --test server.leave-leftovers-5034.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-leave-5034-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const selfreport = require('./engine/selfreport');
const roomhold = require('./engine/roomhold');
const fleet = require('./test-support/fleet');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { try { server.close(); } catch { /* closed */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const SCREEN = { 'sec-fetch-site': 'same-origin' };
async function leave(pid, name) {
  const res = await fetch(`${base}/api/project/${encodeURIComponent(pid)}/agent/${encodeURIComponent(name)}`, { method: 'DELETE', headers: SCREEN });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function taskRow(pid, sentence) {
  const body = await (await fetch(`${base}/api/tasks?view=tasks&project=${encodeURIComponent(pid)}`)).json();
  return body.tasks.find((t) => t.sentence === sentence);
}

let seq = 0;
function project(name) { return projects.create({ name: name + ' ' + (++seq) }); }

test('#5034 a question the agent raised about the project it leaves is cleared, and its card leaves Needs Your Decision', async () => {
  const p = project('Left');
  projects.addAgent(p.id, 'leaver', null);
  tasks.create(p.id, { sentence: 'Held by the leaver', who: 'leaver' });
  assert.equal(selfreport.record('leaver', { state: 'needs_you', project: p.id, because: 'which cover?' }).recorded, true);
  // Control: before the leave, the card IS a decision (the fixture can show the red).
  let board = fleet.install([fleet.agent('leaver', { state: 'needs_you' })]);
  try { assert.equal((await taskRow(p.id, 'Held by the leaver')).state, 'decision', 'fixture: the card was not red before the leave'); } finally { board.restore(); }

  const r = await leave(p.id, 'leaver');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.leftBehind, { reportCleared: true, heldDropped: 0 });
  const now = selfreport.read('leaver');
  assert.equal(now.state, 'idle');
  assert.equal(now.by, 'operator');
  assert.equal(now.because, 'taken off the project ' + p.name + ' by the person, so the needs_you report about it is no longer waiting on anyone');
  assert.ok(!projects.readAll().find((x) => x.id === p.id).agents.includes('leaver'), 'the leave did not land');
  /* The part is still the leaver's (removal does not unassign), and the card is no longer a decision, read against
     the SAME needs_you screen as the before-control (review 1: a different screen proved neither half). */
  board = fleet.install([fleet.agent('leaver', { state: 'needs_you' })]);
  try {
    const row = await taskRow(p.id, 'Held by the leaver');
    assert.equal(tasks.whoOf(row).includes('leaver'), true, 'fixture: the part was unassigned, so this proves nothing about the red');
    assert.notEqual(row.state, 'decision');
  } finally { board.restore(); }
});

test('#5034 a departed holder still asking about the project (raised again, or never cleared) does not turn its old card red', async () => {
  const p = project('Asked again');
  projects.addAgent(p.id, 'asker', null);
  tasks.create(p.id, { sentence: 'Old card', who: 'asker' });
  assert.equal((await leave(p.id, 'asker')).status, 200);
  // The agent raises the old project's question again after it left.
  assert.equal(selfreport.record('asker', { state: 'needs_you', project: p.id, because: 'still about the old one' }).recorded, true);
  const board = fleet.install([fleet.agent('asker', { state: 'needs_you' })]);
  try {
    const row = await taskRow(p.id, 'Old card');
    assert.equal(row.waitingOnPerson, false, JSON.stringify(row));
    assert.notEqual(row.state, 'decision');
  } finally { board.restore(); }
});

test('#5034 control: a question about ANOTHER project is not cleared by leaving this one', async () => {
  const p = project('Left here');
  const q = project('Still there');
  for (const x of [p, q]) projects.addAgent(x.id, 'twoproj', null);
  assert.equal(selfreport.record('twoproj', { state: 'blocked', project: q.id, because: 'waiting on a key' }).recorded, true);
  const r = await leave(p.id, 'twoproj');
  assert.equal(r.status, 200);
  assert.equal(r.json.leftBehind.reportCleared, false);
  const now = selfreport.read('twoproj');
  assert.equal(now.state, 'blocked');
  assert.equal(now.project, q.id);
});

test('#5034 control: an automatic permission wait is about the agent\'s screen and is not cleared', async () => {
  const p = project('Auto');
  projects.addAgent(p.id, 'autowait', null);
  /* Review 2: the wait NAMES the project, so only the auto guard can keep it (an inherited project is refused by
     its own check, which would make this control pass with the guard gone). */
  assert.equal(selfreport.record('autowait', { state: 'needs_you', auto: true, project: p.id, because: 'permission to run Bash' }).recorded, true);
  const before = selfreport.read('autowait');
  assert.equal(before.project, p.id, 'fixture: the auto wait is not tied to the project, so this proves nothing');
  assert.equal(before.projectInferred, false, 'fixture: the project is inherited, so the inherited check would keep it');
  assert.equal(before.by, 'auto');
  const r = await leave(p.id, 'autowait');
  assert.equal(r.json.leftBehind.reportCleared, false);
  assert.equal(selfreport.read('autowait').state, 'needs_you');
});

test('#5034 room posts held for the agent in the project it leaves are dropped; another project\'s are kept', async () => {
  const p = project('Room left');
  const q = project('Room kept');
  for (const x of [p, q]) projects.addAgent(x.id, 'roomer', null);
  assert.equal(roomhold.hold('roomer', p.id, 'm101'), true);
  assert.equal(roomhold.hold('roomer', p.id, 'm102'), true);
  assert.equal(roomhold.hold('roomer', q.id, 'm201'), true);
  const r = await leave(p.id, 'roomer');
  assert.equal(r.status, 200);
  assert.equal(r.json.leftBehind.heldDropped, 2);
  assert.deepEqual(roomhold.heldIn('roomer', p.id), []);
  assert.deepEqual(roomhold.heldIn('roomer', q.id), ['m201']);
});

test('#5034 a repeat leave (not a member) touches nothing and says nothing about leftovers', async () => {
  const p = project('Twice');
  projects.addAgent(p.id, 'twice', null);
  assert.equal((await leave(p.id, 'twice')).status, 200);
  assert.equal(selfreport.record('twice', { state: 'needs_you', project: p.id, because: 'after leaving' }).recorded, true);
  const r = await leave(p.id, 'twice');
  assert.equal(r.status, 200);
  assert.equal(r.json.leftBehind, undefined);
  assert.equal(selfreport.read('twice').state, 'needs_you', 'a leave that moved nothing cleared a report');
});

test('#5034 engine: waitingOnPerson with no members is unchanged; with members it leaves out a departed holder', () => {
  const task = { projectId: 'px', parts: [{ who: 'gone', closedAt: null }] };
  const roster = [{ sessionName: 'gone', isNamedOurs: true, state: 'needs_you', stateProject: 'px' }];
  assert.equal(tasks.waitingOnPerson(task, roster), true, 'control: the old rule counts the holder');
  assert.equal(tasks.waitingOnPerson(task, roster, ['gone']), true, 'a current member still counts');
  assert.equal(tasks.waitingOnPerson(task, roster, ['someone else']), false);
});

test('#5034 a question that only INHERITED the project from an earlier report is not cleared (review 1)', async () => {
  const p = project('Inherited');
  const q = project('Other');
  for (const x of [p, q]) projects.addAgent(x.id, 'inheritor', null);
  assert.equal(selfreport.record('inheritor', { state: 'working', project: p.id }).recorded, true);
  assert.equal(selfreport.record('inheritor', { state: 'needs_you', because: 'my API key expired' }).recorded, true);
  const before = selfreport.read('inheritor');
  assert.equal(before.project, p.id, 'fixture: the question did not inherit the project, so this proves nothing');
  assert.equal(before.projectInferred, true);
  const r = await leave(p.id, 'inheritor');
  assert.equal(r.status, 200);
  assert.equal(r.json.leftBehind.reportCleared, false);
  const now = selfreport.read('inheritor');
  assert.equal(now.state, 'needs_you');
  assert.equal(now.because, 'my API key expired');
});

test('#5034 removing a whole project clears its members\' questions about it and their held posts there', async () => {
  const p = project('Removed');
  const q = project('Survives');
  for (const x of [p, q]) projects.addAgent(x.id, 'orphan', null);
  assert.equal(selfreport.record('orphan', { state: 'blocked', project: p.id, because: 'need the export' }).recorded, true);
  assert.equal(roomhold.hold('orphan', p.id, 'm301'), true);
  assert.equal(roomhold.hold('orphan', q.id, 'm401'), true);
  const res = await fetch(`${base}/api/project/${encodeURIComponent(p.id)}`, { method: 'DELETE', headers: SCREEN });
  assert.equal(res.status, 200, await res.text().catch(() => ''));
  assert.ok(!projects.readAll().some((x) => x.id === p.id), 'the project was not removed');
  const now = selfreport.read('orphan');
  assert.equal(now.state, 'idle');
  assert.equal(now.by, 'operator');
  assert.equal(now.because, 'the project ' + p.name + ' was removed, so the blocked report about it is no longer waiting on anyone');
  assert.deepEqual(roomhold.heldIn('orphan', p.id), []);
  assert.deepEqual(roomhold.heldIn('orphan', q.id), ['m401']);
});

test('#5034 a leave not made from the screen says so in the clear (review 2)', async () => {
  const p = project('Process');
  projects.addAgent(p.id, 'byproc', null);
  assert.equal(selfreport.record('byproc', { state: 'needs_you', project: p.id, because: 'which branch?' }).recorded, true);
  const res = await fetch(`${base}/api/project/${encodeURIComponent(p.id)}/agent/byproc`, { method: 'DELETE' });
  assert.equal(res.status, 200, await res.text().catch(() => ''));
  assert.equal(selfreport.read('byproc').because, 'taken off the project ' + p.name + ' (not from the screen), so the needs_you report about it is no longer waiting on anyone');
});

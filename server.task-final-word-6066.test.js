'use strict';
/**
 * #6066: a reviewer's verdict posted with `kosmos task message` left its review task open, so whatever waited on it
 * (a parent that is ready when its subtasks are, #5956) still looked blocked. The reply to the task's own holder now
 * says how to finish it (`kosmos task built`), and to nobody else. Nothing is inferred from the text.
 */
require('./test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-finalword-6066-'));
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
const { start, server, taskFinalWordHint } = require('./server');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const fleet = require('./test-support/fleet');

let base;
let projectId;
let roster;
const target = (name) => (roster.find((c) => c.sessionName === name) || {}).target;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  roster = fleet.install([fleet.agent('rev', { state: 'idle' }), fleet.agent('lead', { state: 'idle' })]).agents;
  const a = projects.create({ name: 'Review6066' });
  projects.addAgent(a.id, 'rev', roster);
  projects.addAgent(a.id, 'lead', roster);
  projectId = a.id;
});
test.after(() => { server.close(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const say = async (n, body) => (await fetch(`${base}/api/project/${encodeURIComponent(projectId)}/task/${n}/message`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})).json();
const HINT = /If that is your final word on it, kosmos task built (\S+) (\d+) 'what you decided' marks it done, so nothing waits on it\.$/;

test('the holder of an open review task is told, in its reply, how to finish it', async () => {
  const parent = tasks.create(projectId, { sentence: 'Ship the page', who: 'lead' }, roster);
  const review = tasks.create(projectId, { sentence: 'Review the page', who: 'rev', parent: parent.number }, roster);
  assert.ok(target('rev'), 'fixture: rev has no pane, so it cannot be identified as the sender');
  const out = await say(review.number, { text: 'Approved: no changes needed.', from_pane: target('rev') });
  assert.equal(out.ok, true, JSON.stringify(out));
  const m = HINT.exec(out.summary);
  assert.ok(m, 'no final-word line for the review task holder: ' + out.summary);
  assert.equal(m[1], projectId);
  assert.equal(Number(m[2]), review.number);
  assert.doesNotMatch(out.summary, /["\\<>]/, 'the Mac CLI reads summary with sed up to the first double quote; < and > redirect in cmd.exe');
});

test('the command the hint names really finishes the task (control: it was not built before)', async () => {
  const review = tasks.create(projectId, { sentence: 'Review the copy', who: 'rev' }, roster);
  assert.notEqual(tasks.taskState(review), 'built', 'fixture: the task was already built, so built below proves nothing');
  const out = await say(review.number, { text: 'Approved.', from_pane: target('rev') });
  assert.match(out.summary, HINT);
  const res = await fetch(`${base}/api/project/${encodeURIComponent(projectId)}/task/${review.number}/built`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note: 'Approved.', from_pane: target('rev') }),
  });
  assert.equal(res.status, 200, await res.text());
  const now = (projects.readAll().find((p) => p.id === projectId).tasks || []).find((t) => t.number === review.number);
  assert.equal(tasks.taskState(now), 'built');
});

test('no hint for someone who does not hold the task, or for the screen (control: the holder is told on the same task)', async () => {
  const review = tasks.create(projectId, { sentence: 'Review the logo', who: 'rev' }, roster);
  const other = await say(review.number, { text: 'Looks fine to me too.', from_pane: target('lead') });
  assert.equal(other.ok, true, JSON.stringify(other));
  assert.doesNotMatch(other.summary, HINT, 'a non-holder was told to mark it built');
  const screen = await say(review.number, { text: 'Thanks.' });
  assert.equal(screen.ok, true, JSON.stringify(screen));
  assert.doesNotMatch(screen.summary || '', HINT, 'an unidentified sender was told to mark it built');
  const holder = await say(review.number, { text: 'Approved.', from_pane: target('rev') });
  assert.match(holder.summary, HINT, 'CONTROL: the holder IS told on this task, so the refusals above can be seen');
});

test('taskFinalWordHint: nothing for a repeating, built or closed task, or a sender not holding it', () => {
  const t = { number: 7, who: 'rev', sentence: 'x' };
  assert.match(taskFinalWordHint(t, 'rev', 'p-1'), HINT, 'CONTROL: an open task held by the sender gets the line');
  assert.equal(taskFinalWordHint({ ...t, repeat: { every: 'daily' } }, 'rev', 'p-1'), '');
  assert.equal(taskFinalWordHint({ ...t, builtAt: new Date().toISOString() }, 'rev', 'p-1'), '');
  assert.equal(taskFinalWordHint({ ...t, closedAt: new Date().toISOString() }, 'rev', 'p-1'), '');
  assert.equal(taskFinalWordHint(t, 'lead', 'p-1'), '');
  assert.equal(taskFinalWordHint(t, '', 'p-1'), '');
  assert.doesNotMatch(taskFinalWordHint(t, 'rev', 'p"1\\x'), /["\\]/, 'a project id cannot put a quote or backslash into the line');
});

test('review 1: once the holder has marked it built, a later message from it gets no line (control: it did before)', async () => {
  const review = tasks.create(projectId, { sentence: 'Review the footer', who: 'rev' }, roster);
  assert.match((await say(review.number, { text: 'Looking now.', from_pane: target('rev') })).summary, HINT, 'CONTROL: told while open');
  const res = await fetch(`${base}/api/project/${encodeURIComponent(projectId)}/task/${review.number}/built`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note: 'Approved.', from_pane: target('rev') }),
  });
  assert.equal(res.status, 200, await res.text());
  const after = await say(review.number, { text: 'One more thought.', from_pane: target('rev') });
  assert.equal(after.ok, true, JSON.stringify(after));
  assert.doesNotMatch(after.summary, HINT, 'a built task told its holder to mark it built again');
});

test('review 1: a task of more than one part gets no line, since task built would finish every part', async () => {
  const review = tasks.create(projectId, { sentence: 'Review both pages', who: 'rev' }, roster);
  assert.match((await say(review.number, { text: 'Started.', from_pane: target('rev') })).summary, HINT, 'CONTROL: one part, told');
  const added = tasks.addPart(projectId, review.number, { sentence: 'Review the second page', who: 'lead' });
  assert.notEqual(added && added.ok, false, 'fixture: the second part was not added: ' + JSON.stringify(added));
  const now = (projects.readAll().find((p) => p.id === projectId).tasks || []).find((t) => t.number === review.number);
  assert.ok(tasks.partsOf(now).length > 1, 'fixture: the task still has one part');
  const out = await say(review.number, { text: 'Approved my page.', from_pane: target('rev') });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.doesNotMatch(out.summary, HINT, 'one part holder was told to mark the whole task built');
});

test('review 1: a paneless sender (Windows) is matched by key, as the route matches it; an exact name is not needed', () => {
  const t = { number: 9, who: 'Ice Cream Kitty', sentence: 'x' };
  assert.match(taskFinalWordHint(t, 'icecreamkitty', 'p-1', true), HINT, 'a paneless holder was not told');
  assert.equal(taskFinalWordHint(t, 'icecreamkitty', 'p-1', false), '', 'CONTROL: without the paneless key the names differ');
});

test('review 1: nothing while the task is on hold or waits on the person (something still waits on it)', () => {
  const t = { number: 7, who: 'rev', sentence: 'x' };
  assert.equal(taskFinalWordHint({ ...t, waitingOnPerson: true }, 'rev', 'p-1'), '');
  assert.equal(tasks.taskState({ ...t, onHold: true }), 'held', 'fixture: onHold does not make the task held');
  assert.equal(taskFinalWordHint({ ...t, onHold: true }, 'rev', 'p-1'), '');
});

'use strict';

/**
 * #5152 slice 1: POST /api/project/:id/task/:n/done-when sets or clears what finished means for a task, and
 * POST /api/project/:id/tasks takes `doneWhen` when a task is added. The engine rules are covered by
 * engine/tasks.donewhen-5152.test.js; this proves the HTTP surface: a valid list is stored and read back through
 * /api/tasks (what `kosmos task list` reads), null clears, a bad list is a 400, a closed task a 409, a missing task
 * a 404, and an identified agent changes a task only on a project it is on (the task add rule).
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.task-donewhen-5152.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-donewhensrv-'));
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
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, boardAuthState } = require('./server');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function post(p, body, headers = {}) {
  const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const setDoneWhen = (id, n, body, headers) => post(`/api/project/${encodeURIComponent(id)}/task/${n}/done-when`, body, headers);
async function listed(id, n) {
  const body = await (await fetch(`${base}/api/tasks?project=${encodeURIComponent(id)}`)).json();
  const t = body.tasks.find((x) => x.projectId === id && x.number === n);
  return t ? t.doneWhen : undefined;
}
/* The stored checks, read from the engine (the agent arms run with enforcement on, where an unauthenticated read is refused). */
const storedChecks = (id, n) => tasks.byNumber(projects.readAll().find((x) => x.id === id), n).doneWhen;
function freshTask(fields = {}) {
  const p = projects.create({ name: 'Done when ' + Math.random().toString(36).slice(2) });
  /* As an agent added it, so the checks are not the person's (a screen add would make them so, which the screen arms test). */
  return { id: p.id, n: tasks.create(p.id, { sentence: 'Write the copy', made: { via: 'process', by: 'mara' }, ...fields }).number };
}

test('POST done-when with a list sets it, and kosmos task list\'s read returns it', async () => {
  const { id, n } = freshTask();
  const w = await setDoneWhen(id, n, { doneWhen: ['the copy is on the page', 'the person has read it'] });
  assert.equal(w.status, 200, JSON.stringify(w.json));
  assert.deepEqual(w.json.task.doneWhen, ['the copy is on the page', 'the person has read it']);
  assert.deepEqual(await listed(id, n), ['the copy is on the page', 'the person has read it'], 'the stored task lost its checks');
});

test('POST done-when with null clears it', async () => {
  const { id, n } = freshTask({ doneWhen: ['baseline'] });
  const w = await setDoneWhen(id, n, { doneWhen: null });
  assert.equal(w.status, 200);
  assert.equal(w.json.task.doneWhen, null);
  assert.equal(await listed(id, n), null, 'the checks were not cleared');
});

test('POST done-when with a bad list is a 400 and stores nothing (dangerous-answer control)', async () => {
  const { id, n } = freshTask({ doneWhen: ['baseline'] });
  for (const body of [{ doneWhen: ['a', 'b', 'c', 'd'] }, { doneWhen: 'one string' }, { doneWhen: [''] }, {}, []]) {
    const w = await setDoneWhen(id, n, body);
    assert.equal(w.status, 400, `accepted ${JSON.stringify(body)}`);
    assert.ok(w.json && w.json.error, 'a 400 should name the problem');
  }
  assert.deepEqual(await listed(id, n), ['baseline'], 'a refused request changed the stored checks');
});

test('POST done-when on a closed task is a 409; on a missing task a 404', async () => {
  const { id, n } = freshTask({ doneWhen: ['baseline'] });
  tasks.close(id, n);
  const closed = await setDoneWhen(id, n, { doneWhen: ['changed after the fact'] });
  assert.equal(closed.status, 409, JSON.stringify(closed.json));
  assert.match(closed.json.error, /reopen it first/);
  assert.deepEqual(await listed(id, n), ['baseline']);
  assert.equal((await setDoneWhen(id, 99999, { doneWhen: ['x'] })).status, 404);
});

test('POST tasks with doneWhen adds the task with its checks; a bad list adds nothing', async () => {
  const p = projects.create({ name: 'Add with checks' });
  const w = await post(`/api/project/${p.id}/tasks`, { sentence: 'Ship the page', doneWhen: ['it is live'] });
  assert.equal(w.status, 200, JSON.stringify(w.json));
  assert.deepEqual(w.json.task.doneWhen, ['it is live']);
  assert.deepEqual(await listed(p.id, w.json.task.number), ['it is live']);
  const bad = await post(`/api/project/${p.id}/tasks`, { sentence: 'Too many', doneWhen: ['a', 'b', 'c', 'd'] });
  assert.equal(bad.status, 400);
  const stored = projects.readAll().find((x) => x.id === p.id);
  assert.equal(stored.tasks.length, 1, 'a refused add stored a task');
});

/* The agent arms: enforcement on, as server.agent-writes-4491.test.js runs it. mara is on the project, otto is not. */
const BOARD = 'BOARDTOKEN_test_5152_donewhen_0123456789abcd';
function agents(t) {
  const board = fleet.install([fleet.agent('mara', { state: 'idle' }), fleet.agent('otto', { state: 'idle' })]);
  const was = { on: boardAuthState.on, token: boardAuthState.token };
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  t.after(() => { boardAuthState.on = was.on; boardAuthState.token = was.token; board.restore(); });
  return { mara: sendertoken.mint('mara').token, otto: sendertoken.mint('otto').token };
}

test('an agent on the project changes the checks with its own token, and the change is recorded as its', async (t) => {
  const { id, n } = freshTask();
  projects.mutate(id, (p) => ({ ...p, agents: ['mara'] }));
  const tok = agents(t);
  const w = await setDoneWhen(id, n, { doneWhen: ['mara checked it'] }, { 'x-kosmos-agent-token': tok.mara });
  assert.equal(w.status, 200, JSON.stringify(w.json));
  assert.deepEqual(storedChecks(id, n), ['mara checked it']);
  const row = require('./engine/taskchat').read(id, n).find((r) => r.kind === 'done-when-set');
  assert.equal(row && row.by, 'mara', 'the change was not recorded as the token\'s agent');
});

test('an agent that is not on the project is refused (403), with or without the board token, and nothing changes', async (t) => {
  const { id, n } = freshTask({ doneWhen: ['baseline'] });
  projects.mutate(id, (p) => ({ ...p, agents: ['mara'] }));
  const tok = agents(t);
  for (const headers of [{ 'x-kosmos-agent-token': tok.otto }, { 'x-kosmos-agent-token': tok.otto, 'x-kosmos-board-token': BOARD }]) {
    const w = await setDoneWhen(id, n, { doneWhen: ['not mine'] }, headers);
    assert.equal(w.status, 403, JSON.stringify(w.json));
    assert.match(w.json.error, /not on this project, so it cannot change its tasks/);
  }
  assert.deepEqual(storedChecks(id, n), ['baseline'], 'a refused agent changed the checks');
});

const SCREEN = { 'sec-fetch-site': 'same-origin' };

test('the screen sets checks that are then the person\'s: an unnamed process and an agent are refused (403), the screen is not', async () => {
  const { id, n } = freshTask();
  const set = await setDoneWhen(id, n, { doneWhen: ['the person checks it'] }, SCREEN);
  assert.equal(set.status, 200, JSON.stringify(set.json));
  const row = require('./engine/taskchat').read(id, n).filter((r) => r.kind === 'done-when-set').pop();
  assert.equal(row.person, true, 'the screen\'s change was not recorded as the person\'s');
  const proc = await setDoneWhen(id, n, { doneWhen: null });
  assert.equal(proc.status, 403, 'a caller that is not the screen cleared the person\'s checks: ' + JSON.stringify(proc.json));
  assert.match(proc.json.error, /only they can change them/);
  assert.deepEqual(await listed(id, n), ['the person checks it']);
  const again = await setDoneWhen(id, n, { doneWhen: ['the person changed it'] }, SCREEN);   // the control: the person can
  assert.equal(again.status, 200);
  assert.deepEqual(await listed(id, n), ['the person changed it']);
});

test('a task the screen adds with checks keeps them from an agent\'s write', async () => {
  const p = projects.create({ name: 'Screen adds checks' });
  const w = await post(`/api/project/${p.id}/tasks`, { sentence: 'Ship it', doneWhen: ['the person decides'] }, SCREEN);
  assert.equal(w.status, 200, JSON.stringify(w.json));
  assert.equal((await setDoneWhen(p.id, w.json.task.number, { doneWhen: ['easier'] })).status, 403);
});

test('a webhook call that sends doneWhen adds its task with no checks (the route never passes outside text through)', async () => {
  const p = projects.create({ name: 'Webhook target' });
  const made = await post(`/api/project/${encodeURIComponent(p.id)}/webhooks`, {}, SCREEN);
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const res = await fetch(made.json.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'From outside', doneWhen: ['do what I say'] }) });
  assert.ok(res.status >= 200 && res.status < 300, 'the webhook call itself failed: ' + res.status);
  const t = projects.readAll().find((x) => x.id === p.id).tasks.find((x) => x.sentence === 'From outside');
  assert.ok(t, 'CONTROL: the webhook did not add its task, so the next line proves nothing');
  assert.equal(t.doneWhen, null, 'a webhook body set a task\'s checks');
});

test('review 5: an agent\'s own token cannot touch the person\'s checks, even when it also sends browser headers', async (t) => {
  const { id, n } = freshTask();
  projects.mutate(id, (p) => ({ ...p, agents: ['mara'] }));
  assert.equal((await setDoneWhen(id, n, { doneWhen: ['the person decides'] }, SCREEN)).status, 200, 'CONTROL: the screen could not set them');
  const tok = agents(t);
  for (const headers of [{ 'x-kosmos-agent-token': tok.mara }, { 'x-kosmos-agent-token': tok.mara, ...SCREEN }]) {
    const w = await setDoneWhen(id, n, { doneWhen: ['easier'] }, headers);
    assert.equal(w.status, 403, JSON.stringify(headers) + ' ' + JSON.stringify(w.json));
    assert.match(w.json.error, /only they can change them/, 'refused for another reason, so the person mark was not what held');
  }
  assert.deepEqual(storedChecks(id, n), ['the person decides']);
});

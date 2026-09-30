'use strict';

/**
 * #4491 slice 5: `kosmos task add` and `kosmos task close` answer to the agent's own token. The board names the
 * caller from it (or from its pane) and an identified agent adds and closes tasks only in a project it is on, the
 * line task message and task built already draw. A caller nobody can name (the page, the person's terminal) is as
 * before.
 *
 * Same harness as server.agent-token-gate-4491.test.js: the board boots fully sandboxed, then enforcement is
 * flipped on in memory, so no real store is touched. The task engine's writes are stubbed, so nothing is written.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agentwrites-4491-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

const { start, server, boardAuthState } = require('./server');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');
const projectsEngine = require('./engine/projects');
const tasksEngine = require('./engine/tasks');
const messagesEngine = require('./engine/messages');

const BOARD = 'BOARDTOKEN_test_4491_writes_0123456789abcdef';
const GATE_REFUSAL = /this board belongs to the account that started it/;
let base;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
});
test.after(() => {
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function call(method, p, { headers = {}, body } = {}) {
  const res = await fetch(base + p, {
    method, redirect: 'manual',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text().catch(() => '');
  return { code: res.status, text };
}
const refusedAtGate = (r) => r.code === 403 && GATE_REFUSAL.test(r.text);
const asAgent = (t) => ({ 'x-kosmos-agent-token': t });
const withBoard = (h = {}) => ({ 'x-kosmos-board-token': BOARD, ...h });

/* A fleet of two (mara is on p4491, otto is not), the project record, and the task engine's writes recorded, not made. */
function world(t, { members = ['mara'], unreadable = () => false } = {}) {
  const board = fleet.install([fleet.agent('mara', { state: 'idle' }), fleet.agent('otto', { state: 'idle' })]);
  const real = { readAll: projectsEngine.readAll, create: tasksEngine.create, close: tasksEngine.close, reopen: tasksEngine.reopen };
  const made = [];
  const acts = [];
  projectsEngine.readAll = () => {
    if (unreadable()) { const e = new Error('unreadable'); e.code = 'UNREADABLE'; throw e; }
    return [{ id: 'p4491', name: 'p4491', agents: members, tasks: [] }];
  };
  tasksEngine.create = (id, fields) => { made.push({ id, by: fields.made.by, via: fields.made.via, sentence: fields.sentence }); return { number: made.length, sentence: fields.sentence, who: null }; };
  tasksEngine.close = (id, n) => { acts.push(['close', id, String(n)]); return { number: Number(n), state: 'closed' }; };
  tasksEngine.reopen = (id, n) => { acts.push(['reopen', id, String(n)]); return { number: Number(n), state: 'open' }; };
  t.after(() => { Object.assign(projectsEngine, { readAll: real.readAll }); Object.assign(tasksEngine, { create: real.create, close: real.close, reopen: real.reopen }); board.restore(); });
  return { made, acts, mara: sendertoken.mint('mara').token, otto: sendertoken.mint('otto').token, roster: board.roster };
}

test('CONTROL: task add and task close are refused at the gate with no credential and with a token nobody issued', async () => {
  for (const p of ['/api/project/p4491/tasks', '/api/project/p4491/task/1/close']) {
    assert.ok(refusedAtGate(await call('POST', p, { body: {} })), `the gate did not refuse a bare POST ${p}, so nothing below can be trusted`);
    assert.ok(refusedAtGate(await call('POST', p, { headers: asAgent('c'.repeat(64)), body: {} })), `POST ${p} passed the gate with a token nobody issued`);
  }
});

test('task add: a member adds with only its own token, and the task is recorded as added by it', async (t) => {
  const w = world(t);
  const r = await call('POST', '/api/project/p4491/tasks', { headers: asAgent(w.mara), body: { sentence: 'write the docs' } });
  assert.equal(r.code, 200, 'a member could not add a task on its token alone: ' + r.code + ' ' + r.text.slice(0, 160));
  assert.deepEqual(w.made, [{ id: 'p4491', by: 'mara', via: 'process', sentence: 'write the docs' }], 'the task was not recorded as the token\'s agent');
});

test('task add: an agent that is not on the project is refused, with or without the board token, and nothing is added', async (t) => {
  const w = world(t);
  const alone = await call('POST', '/api/project/p4491/tasks', { headers: asAgent(w.otto), body: { sentence: 'not mine to add' } });
  assert.equal(alone.code, 403, 'a non-member added a task: ' + alone.code + ' ' + alone.text.slice(0, 160));
  assert.match(JSON.parse(alone.text).error, /not on this project, so it cannot add tasks to it/);
  const both = await call('POST', '/api/project/p4491/tasks', { headers: withBoard(asAgent(w.otto)), body: { sentence: 'not mine to add' } });
  assert.equal(both.code, 403, 'the board token let an identified non-member add a task (task message and task built refuse it too)');
  assert.deepEqual(w.made, [], 'a refused add still reached the task engine');
});

test('task add: the body cannot name another agent; the header token is the caller', async (t) => {
  const w = world(t);
  const mara = w.roster.find((c) => c.sessionName === 'mara');
  const spoof = await call('POST', '/api/project/p4491/tasks', { headers: asAgent(w.otto), body: { sentence: 'as mara', token: w.mara, from_pane: mara.session } });
  assert.equal(spoof.code, 403, 'a body naming a member let a non-member add: ' + spoof.code);
  assert.deepEqual(w.made, []);
});

test('task add: a pane that resolves to an agent names it; a caller nobody can name is as before', async (t) => {
  const w = world(t);
  /* The tokenless Mac CLI sends $TMUX_PANE (%N), which the handler resolves through messages.resolveSender. Stubbed
     here, as in the slice-3 tests: tmux is not running in the suite. */
  const realResolve = messagesEngine.resolveSender;
  const asked = [];
  messagesEngine.resolveSender = (pane, roster) => {
    asked.push(pane);
    const name = pane === '%7' ? 'otto' : pane === '%8' ? 'mara' : null;
    const card = name && roster.find((c) => c.sessionName === name);
    return card ? { ok: true, card } : { ok: false, because: 'no such pane' };
  };
  t.after(() => { messagesEngine.resolveSender = realResolve; });
  const add = (headers, body) => call('POST', '/api/project/p4491/tasks', { headers, body });
  const byPane = await add(withBoard(), { sentence: 'by pane', from_pane: '%8' });
  assert.equal(byPane.code, 200, byPane.text.slice(0, 160));
  assert.equal(w.made[0].by, 'mara', 'a pane that resolves to an agent did not name it');
  const outsiderPane = await add(withBoard(), { sentence: 'by pane', from_pane: '%7' });
  assert.equal(outsiderPane.code, 403, 'a non-member named by its pane added a task: ' + outsiderPane.code);
  /* A pane that resolves to nobody, no pane at all (the person's terminal), and the page: not refused, no name. */
  const stranger = await add(withBoard(), { sentence: 'a pane nobody holds', from_pane: '%99' });
  assert.equal(stranger.code, 200, stranger.text.slice(0, 160));
  const terminal = await add(withBoard(), { sentence: 'from a terminal', from_pane: '' });
  assert.equal(terminal.code, 200, terminal.text.slice(0, 160));
  const page = await add(withBoard({ 'sec-fetch-site': 'same-origin', origin: base }), { sentence: 'from the page', from_pane: '%7' });
  assert.equal(page.code, 200, 'the page was held to a pane it sent: ' + page.code + ' ' + page.text.slice(0, 160));
  assert.deepEqual(w.made.slice(1).map((m) => [m.by, m.via]), [[null, 'process'], [null, 'process'], [null, 'screen']]);
  assert.deepEqual(asked, ['%8', '%7', '%99'], 'the pane was not asked of resolveSender exactly when a process offered one');
});

test('a token the board cannot resolve is refused, never swapped for a pane that would have named a member', async (t) => {
  const w = world(t);
  const realResolve = messagesEngine.resolveSender;
  messagesEngine.resolveSender = (pane, roster) => ({ ok: true, card: roster.find((c) => c.sessionName === 'mara') });
  t.after(() => { messagesEngine.resolveSender = realResolve; });
  /* The board token gets it past the gate, so the handler is what judges the bad agent token. */
  const bad = withBoard(asAgent('d'.repeat(64)));
  const add = await call('POST', '/api/project/p4491/tasks', { headers: bad, body: { sentence: 'as mara', from_pane: '%8' } });
  assert.equal(add.code, 403, 'a bad token fell back to the pane on task add: ' + add.code + ' ' + add.text.slice(0, 120));
  const close = await call('POST', '/api/project/p4491/task/1/close', { headers: bad });
  assert.equal(close.code, 403, 'a bad token was ignored on task close: ' + close.code + ' ' + close.text.slice(0, 120));
  assert.deepEqual([w.made, w.acts], [[], []]);
  /* CONTROL: the same pane with no token at all IS named, so the 403 above is the bad token. */
  assert.equal((await call('POST', '/api/project/p4491/tasks', { headers: withBoard(), body: { sentence: 'by pane', from_pane: '%8' } })).code, 200);
  assert.equal(w.made[0].by, 'mara');
});

test('task add: when the projects cannot be read, an identified agent is refused (503) and nothing is added', async (t) => {
  let blind = false;
  const w = world(t, { unreadable: () => blind });
  assert.equal((await call('POST', '/api/project/p4491/tasks', { headers: asAgent(w.mara), body: { sentence: 'ok' } })).code, 200, 'control: a member adds while the list is readable');
  blind = true;
  const r = await call('POST', '/api/project/p4491/tasks', { headers: asAgent(w.mara), body: { sentence: 'blind' } });
  assert.equal(r.code, 503, 'an unreadable projects list let an identified agent through: ' + r.code + ' ' + r.text.slice(0, 120));
  assert.equal(w.made.length, 1, 'the blind add reached the task engine');
});

test('task close: a member closes with only its own token; a non-member is refused and nothing is closed', async (t) => {
  const w = world(t);
  const member = await call('POST', '/api/project/p4491/task/3/close', { headers: asAgent(w.mara) });
  assert.equal(member.code, 200, 'a member could not close on its token alone: ' + member.code + ' ' + member.text.slice(0, 160));
  const outsider = await call('POST', '/api/project/p4491/task/4/close', { headers: asAgent(w.otto) });
  assert.equal(outsider.code, 403, 'a non-member closed a task: ' + outsider.code + ' ' + outsider.text.slice(0, 160));
  assert.match(JSON.parse(outsider.text).error, /not on this project, so it cannot close its tasks/);
  const outsiderBoth = await call('POST', '/api/project/p4491/task/4/close', { headers: withBoard(asAgent(w.otto)) });
  assert.equal(outsiderBoth.code, 403, 'the board token let an identified non-member close a task');
  assert.deepEqual(w.acts, [['close', 'p4491', '3']], 'a refused close still reached the task engine');
});

test('task close: a caller with no agent token is as before (the page, the person\'s terminal)', async (t) => {
  const w = world(t);
  const terminal = await call('POST', '/api/project/p4491/task/5/close', { headers: withBoard() });
  assert.equal(terminal.code, 200, terminal.text.slice(0, 160));
  const page = await call('POST', '/api/project/p4491/task/6/close', { headers: withBoard({ 'sec-fetch-site': 'same-origin', origin: base }) });
  assert.equal(page.code, 200, page.text.slice(0, 160));
  assert.deepEqual(w.acts, [['close', 'p4491', '5'], ['close', 'p4491', '6']]);
});

test('reopen stays behind the board token; with it, an identified agent still has to be on the project', async (t) => {
  const w = world(t);
  assert.ok(refusedAtGate(await call('POST', '/api/project/p4491/task/3/reopen', { headers: asAgent(w.mara) })), 'reopen opened to an agent token alone');
  assert.equal((await call('POST', '/api/project/p4491/task/3/reopen', { headers: withBoard(asAgent(w.mara)) })).code, 200, 'a member with the board token could not reopen');
  const outsider = await call('POST', '/api/project/p4491/task/3/reopen', { headers: withBoard(asAgent(w.otto)) });
  assert.equal(outsider.code, 403, 'an identified non-member reopened a task: ' + outsider.code);
  assert.match(JSON.parse(outsider.text).error, /cannot reopen its tasks/);
  assert.deepEqual(w.acts, [['reopen', 'p4491', '3']]);
});

test('only these two writes opened: every neighbour stays behind the board token', async (t) => {
  const w = world(t);
  const closed = [
    ['POST', '/api/project/p4491/task/1/reopen'], ['POST', '/api/project/p4491/task/1/due'], ['POST', '/api/project/p4491/task/1/close/'],
    ['POST', '/api/project/p4491/task/x/close'], ['POST', '/api/project/a/b/tasks'], ['POST', '/api/project/p4491/tasks/'],
    ['PUT', '/api/project/p4491/tasks'], ['DELETE', '/api/project/p4491/tasks'], ['GET', '/api/project/p4491/tasks'],
    ['POST', '/api/tasks/close'], ['POST', '/api/projects'], ['POST', '/api/project/p4491/room/reopen'], ['GET', '/api/project/p4491/task/1/activity'],
  ];
  for (const [method, p] of closed) {
    const r = await call(method, p, { headers: asAgent(w.mara), body: method === 'GET' ? undefined : {} });
    assert.ok(refusedAtGate(r), `${method} ${p} was reachable with only an agent token: ${r.code} ${r.text.slice(0, 80)}`);
  }
});

test('a revoked token neither adds nor closes', async (t) => {
  const w = world(t);
  sendertoken.revoke('mara');
  assert.ok(refusedAtGate(await call('POST', '/api/project/p4491/tasks', { headers: asAgent(w.mara), body: { sentence: 'late' } })));
  assert.ok(refusedAtGate(await call('POST', '/api/project/p4491/task/1/close', { headers: asAgent(w.mara) })));
  assert.deepEqual([w.made, w.acts], [[], []]);
});

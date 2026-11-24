'use strict';

/**
 * kosmos#8989: a running agent reads its instructions once, at its start. When a manager agent (or the person) closes
 * a task the agent holds, Kosmos rewrites the agent's "Your projects" section, and the agent is owed a line telling it
 * to read that section again, since it did not make the change. Its own close owes none (it knows). The task route
 * tells each assignee through projects.syncAgent with byOther; this checks the route passes it right, from the token.
 * Same sandboxed harness as server.agent-writes-4491.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rereadclose-8989-'));
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

const BOARD = 'BOARDTOKEN_test_8989_reread_0123456789abcdef';
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

/* mara and otto are both on p8989. The close is recorded, not made; it hands back a task held by `holder`. What each
   assignee's sync was asked is recorded too (projects.syncAgent is stubbed, so no instructions file is written). */
function world(t, holder) {
  const board = fleet.install([fleet.agent('mara', { state: 'idle' }), fleet.agent('otto', { state: 'idle' })]);
  const real = { readAll: projectsEngine.readAll, syncAgent: projectsEngine.syncAgent, close: tasksEngine.close, reopen: tasksEngine.reopen };
  const synced = [];
  projectsEngine.readAll = () => [{ id: 'p8989', name: 'p8989', agents: ['mara', 'otto'], tasks: [], made: { via: 'screen', by: null } }];
  projectsEngine.syncAgent = (who, roster, opts) => { synced.push([who, !!(opts && opts.byOther)]); return { state: projectsEngine.TOLD.TOLD, changed: true }; };
  tasksEngine.close = (id, n) => ({ number: Number(n), who: holder, state: 'closed' });
  tasksEngine.reopen = (id, n) => ({ number: Number(n), who: holder, state: 'open' });
  t.after(() => { Object.assign(projectsEngine, { readAll: real.readAll, syncAgent: real.syncAgent }); Object.assign(tasksEngine, { close: real.close, reopen: real.reopen }); board.restore(); });
  return { synced, mara: sendertoken.mint('mara').token, otto: sendertoken.mint('otto').token };
}

/* kosmos#8989: the holder of a task someone else closed is owed a re-read of its projects section. */
test('a task closed by another agent (a manager) is synced for its holder as a change it did not make', async (t) => {
  const w = world(t, 'otto');
  const r = await call('POST', '/api/project/p8989/task/1/close', { headers: asAgent(w.mara) });
  assert.equal(r.code, 200, 'the close failed: ' + r.code + ' ' + r.text.slice(0, 160));
  assert.deepEqual(w.synced, [['otto', true]]);
});

test('CONTROL: an agent closing its own task is synced as its own change, owing nothing', async (t) => {
  const w = world(t, 'otto');
  const r = await call('POST', '/api/project/p8989/task/1/close', { headers: asAgent(w.otto) });
  assert.equal(r.code, 200, 'the close failed: ' + r.code + ' ' + r.text.slice(0, 160));
  assert.deepEqual(w.synced, [['otto', false]]);
});

test('a close with no agent token (the person, or their terminal) is a change the holder did not make', async (t) => {
  const w = world(t, 'otto');
  const r = await call('POST', '/api/project/p8989/task/1/close', { headers: withBoard() });
  assert.equal(r.code, 200, 'the close failed: ' + r.code + ' ' + r.text.slice(0, 160));
  assert.deepEqual(w.synced, [['otto', true]]);
});

test('a reopen by another agent is owed the same way; the holder\'s own reopen is not', async (t) => {
  const w = world(t, 'otto');
  const r = await call('POST', '/api/project/p8989/task/1/reopen', { headers: withBoard(asAgent(w.mara)), body: { why: 'not done' } });
  assert.equal(r.code, 200, r.text.slice(0, 200));
  assert.equal((await call('POST', '/api/project/p8989/task/1/reopen', { headers: withBoard(asAgent(w.otto)), body: { why: 'not done' } })).code, 200);
  assert.deepEqual(w.synced, [['otto', true], ['otto', false]]);
});

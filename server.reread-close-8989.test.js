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

const { start, server, boardAuthState, givePart } = require('./server');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');
const projectsEngine = require('./engine/projects');
const tasksEngine = require('./engine/tasks');

const BOARD = 'BOARDTOKEN_test_8989_reread_0123456789abcdef';
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
const asAgent = (t) => ({ 'x-kosmos-agent-token': t });
const withBoard = (h = {}) => ({ 'x-kosmos-board-token': BOARD, ...h });

/* mara and otto are both on p8989. The close is recorded, not made; it hands back a task held by `holder`. What each
   assignee's sync was asked is recorded too (projects.syncAgent is stubbed, so no instructions file is written). */
function world(t, holder, { stored = [], closedWith, record = {}, more = [], members = ['mara', 'otto'] } = {}) {
  const board = fleet.install(members.map((m) => fleet.agent(m, { state: 'idle' })));
  const real = { readAll: projectsEngine.readAll, syncAgent: projectsEngine.syncAgent, close: tasksEngine.close, reopen: tasksEngine.reopen,
    setPartClosed: tasksEngine.setPartClosed, assignPart: tasksEngine.assignPart, setText: tasksEngine.setText };
  const synced = [];
  projectsEngine.readAll = () => [{ id: 'p8989', name: 'p8989', agents: members, tasks: stored, made: { via: 'screen', by: null }, ...record }, ...more];
  projectsEngine.syncAgent = (who, roster, opts) => { synced.push([who, !!(opts && opts.byOther)]); return { state: projectsEngine.TOLD.TOLD, changed: true }; };
  tasksEngine.close = (id, n) => ({ number: Number(n), who: holder, state: 'closed', ...(closedWith ? { closedWith } : {}) });
  tasksEngine.setPartClosed = (id, n) => ({ ok: true, task: { number: Number(n), who: holder } });
  tasksEngine.assignPart = (id, n, part, who) => ({ ok: true, changed: true, previous: 'otto', task: { number: Number(n), sentence: 'x', parts: [{ id: 1, who }] } });
  tasksEngine.setText = (id, n) => ({ titleChanged: true, changed: true, task: { number: Number(n), who: holder, sentence: 'new words' } });
  // Every stub is put back in one place, from the one snapshot.
  t.after(() => { Object.assign(projectsEngine, { readAll: real.readAll, syncAgent: real.syncAgent }); Object.assign(tasksEngine, { close: real.close, reopen: real.reopen, setPartClosed: real.setPartClosed, assignPart: real.assignPart, setText: real.setText }); board.restore(); });
  tasksEngine.reopen = (id, n) => ({ number: Number(n), who: holder, state: 'open' });

  const tokens = Object.fromEntries(members.map((m) => [m, sendertoken.mint(m).token]));
  return { synced, tokens, mara: tokens.mara, otto: tokens.otto };
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

const screen = (h = {}) => withBoard({ 'sec-fetch-site': 'same-origin', ...h });

test('the screen\'s close of several tasks owes every holder a re-read', async (t) => {
  const w = world(t, 'otto', { stored: [{ number: 1, sentence: 'one', who: 'otto' }] });
  const r = await call('POST', '/api/tasks/close', { headers: screen(), body: { tasks: [{ projectId: 'p8989', number: 1 }] } });
  assert.equal(r.code, 200, r.text.slice(0, 200));
  assert.deepEqual(w.synced, [['otto', true]]);
});

test('closing a task with its built subtasks: the closer is not owed, a subtask\'s other holder is', async (t) => {
  const w = world(t, 'otto', { stored: [{ number: 1, sentence: 'one', who: 'otto' }, { number: 2, sentence: 'two', who: 'mara' }], closedWith: [2] });
  const r = await call('POST', '/api/project/p8989/task/1/close', { headers: asAgent(w.otto) });
  assert.equal(r.code, 200, r.text.slice(0, 200));
  assert.deepEqual(w.synced, [['otto', false], ['mara', true]]);
});

/* The part route names who closed the part, and passes it on. Whether a notice follows is the engine's call: the section
   lists tasks, not parts, so a part closed while the task's other parts stay open changes nothing there and owes
   nothing (the plan's stated limit); closing the last part closes the task, and that is owed. */
test('the part close route passes who closed the part: another agent, then the holder itself', async (t) => {
  const w = world(t, 'otto');
  assert.equal((await call('POST', '/api/project/p8989/task/1/part/1/close', { headers: withBoard(asAgent(w.mara)), body: {} })).code, 200);
  assert.equal((await call('POST', '/api/project/p8989/task/1/part/1/close', { headers: withBoard(asAgent(w.otto)), body: {} })).code, 200);
  assert.deepEqual(w.synced, [['otto', true], ['otto', false]]);
});

test('a part moved away from its holder on the screen syncs the old holder too, as a change it did not make', async (t) => {
  const w = world(t, 'mara', { stored: [{ number: 1, sentence: 'one', parts: [{ id: 1, who: 'otto' }] }] });
  const r = await call('POST', '/api/project/p8989/task/1/part/1/who', { headers: screen(), body: { who: 'mara' } });
  assert.equal(r.code, 200, r.text.slice(0, 200));
  assert.deepEqual(w.synced.filter(([who]) => who === 'otto'), [['otto', true]], 'the agent it was taken from was not synced as told by another');
});

test('a part an agent moves away from itself is synced as its own change', async (t) => {
  const w = world(t, 'mara', { stored: [{ number: 1, sentence: 'one', parts: [{ id: 1, who: 'otto' }] }] });
  const r = await call('POST', '/api/project/p8989/task/1/part/1/who', { headers: withBoard(asAgent(w.otto)), body: { who: 'mara' } });
  assert.equal(r.code, 200, r.text.slice(0, 200));
  assert.deepEqual(w.synced.filter(([who]) => who === 'otto'), [['otto', false]], 'its own move was owed as someone else\'s');
});

test('a title changed by another agent is owed to the holder; its own retitle is not', async (t) => {
  const w = world(t, 'otto');
  assert.equal((await call('POST', '/api/project/p8989/task/1/text', { headers: withBoard(asAgent(w.mara)), body: { sentence: 'new words' } })).code, 200);
  assert.equal((await call('POST', '/api/project/p8989/task/1/text', { headers: withBoard(asAgent(w.otto)), body: { sentence: 'new words' } })).code, 200);
  assert.deepEqual(w.synced, [['otto', true], ['otto', false]]);
});

test('a holder named by its key in another spelling is still itself', async (t) => {
  const w = world(t, 'Otto');
  const r = await call('POST', '/api/project/p8989/task/1/close', { headers: asAgent(w.otto) });
  assert.equal(r.code, 200, r.text.slice(0, 200));
  assert.deepEqual(w.synced, [['Otto', false]]);
});

// Review 5: no notice about a project the person paused, or switched this agent's swarm off in (#3564). The sync still runs.
test('a task closed by another on a paused project is synced but owes no notice', async (t) => {
  const w = world(t, 'otto', { record: { paused: true } });
  assert.equal((await call('POST', '/api/project/p8989/task/1/close', { headers: asAgent(w.mara) })).code, 200);
  assert.deepEqual(w.synced, [['otto', false]]);
});

test('a task closed by another on a project with the holder\'s swarm switched off owes it no notice', async (t) => {
  const w = world(t, 'otto', { record: { swarmOff: ['otto'] } });
  assert.equal((await call('POST', '/api/project/p8989/task/1/close', { headers: asAgent(w.mara) })).code, 200);
  assert.deepEqual(w.synced, [['otto', false]]);
});

test('the screen\'s bulk close: owed when any closed task is on a project not paused, not when all are', async (t) => {
  const w = world(t, 'otto', {
    record: { paused: true }, stored: [{ number: 1, sentence: 'one', who: 'otto' }],
    more: [{ id: 'q8989', name: 'q8989', agents: ['otto'], tasks: [{ number: 1, sentence: 'live', who: 'otto' }], made: { via: 'screen', by: null } }],
  });
  assert.equal((await call('POST', '/api/tasks/close', { headers: screen(), body: { tasks: [{ projectId: 'p8989', number: 1 }] } })).code, 200);
  assert.equal((await call('POST', '/api/tasks/close', { headers: screen(), body: { tasks: [{ projectId: 'p8989', number: 1 }, { projectId: 'q8989', number: 1 }] } })).code, 200);
  assert.deepEqual(w.synced, [['otto', false], ['otto', true]]);
});

// Review 5: the Assigner's failover source is already owed one line about the move (engine/failovertell.js), so the sync
// that drops the part from its section owes no second one. A screen move of the same part (the control) owes one.
test('a failover move syncs the source without a second notice; a screen move owes one', async (t) => {
  const w = world(t, 'mara', { stored: [{ number: 1, sentence: 'one', parts: [{ id: 1, who: 'otto' }] }] });
  const chat = require('./engine/chat');
  const realDeliver = chat.deliver;
  chat.deliver = () => ({ state: chat.DELIVERY.PLACED, because: null });   // the Assigner keeps a move only once its line is placed
  let g1;
  try { g1 = await givePart('p8989', 1, 1, 'mara', { assigner: true, from: 'otto' }); } finally { chat.deliver = realDeliver; }
  assert.equal(g1.ok, true, g1.because);
  const g2 = await givePart('p8989', 1, 1, 'mara', { screen: true, noPage: true });
  assert.equal(g2.ok, true, g2.because);
  assert.deepEqual(w.synced.filter(([who]) => who === 'otto'), [['otto', false], ['otto', true]]);
});

test('a failover naming another source than the part\'s real previous holder still owes that holder its notice', async (t) => {
  const w = world(t, 'mara');   // the stubbed assignPart answers previous: 'otto'
  const chat = require('./engine/chat');
  const realDeliver = chat.deliver;
  chat.deliver = () => ({ state: chat.DELIVERY.PLACED, because: null });
  let g;
  try { g = await givePart('p8989', 1, 1, 'mara', { assigner: true, from: 'somebody-else' }); } finally { chat.deliver = realDeliver; }
  assert.equal(g.ok, true, g.because);
  assert.deepEqual(w.synced.filter(([who]) => who === 'otto'), [['otto', true]]);
});

// Review 7: two members whose names share a store key are two agents. One closing the other's task owes the holder its
// notice; the key alone must not read them as one (the take route and heldByCaller refuse the same way).
test('two members sharing a key: one closing the other\'s task owes the holder; each one\'s own close does not', async (t) => {
  const w = world(t, 'Mona Lisa', { members: ['Mona Lisa', 'monalisa'] });
  assert.equal((await call('POST', '/api/project/p8989/task/1/close', { headers: asAgent(w.tokens.monalisa) })).code, 200);
  assert.equal((await call('POST', '/api/project/p8989/task/1/close', { headers: asAgent(w.tokens['Mona Lisa']) })).code, 200);
  assert.deepEqual(w.synced, [['Mona Lisa', true], ['Mona Lisa', false]]);
});

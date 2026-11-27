'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#9178: new work on a task drops its built mark (#3951), and since #9176 every holder's instruction block shows
 * that mark, so the routes that add a part or give one open re-sync every holder AND owe a re-read to the ones this
 * change was not already told to: never the part's new holder (its heard line is this news), never the agent that made
 * the change. Same sandboxed harness as server.built-sync-9176.test.js: the write and projects.syncAgent are stubbed,
 * and what each holder's sync was asked is recorded.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-builtnotice-9178-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TASK_MSG_CAP = '0';   // the heard line is not typed; only the sync is under test

const { start, server, boardAuthState } = require('./server');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');
const projectsEngine = require('./engine/projects');
const tasksEngine = require('./engine/tasks');

const BOARD = 'BOARDTOKEN_test_9178_builtnotice_0123456789ab';
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
const screen = () => ({ 'x-kosmos-board-token': BOARD, 'sec-fetch-site': 'same-origin' });
const withBoard = (h = {}) => ({ 'x-kosmos-board-token': BOARD, ...h });   // an agent's CLI call carries both (as server.reread-close-8989.test.js)

/* mara and otto hold parts 1 and 2 of task 1 on p9178, which was built. A write adds part 3 for otto, or gives part 2
   (open) to otto. `dropped` is what tasks.droppedBuiltForWork answers for the written task: the real one answers from
   writeParts' own mark (engine/tasks.js), which these stubs do not run. */
function world(t, { dropped = true } = {}) {
  const members = ['mara', 'otto', 'nia'];
  const board = fleet.install(members.map((m) => fleet.agent(m, { state: 'idle' })));
  const real = { readAll: projectsEngine.readAll, syncAgent: projectsEngine.syncAgent, addPart: tasksEngine.addPart, assignPart: tasksEngine.assignPart, droppedBuiltForWork: tasksEngine.droppedBuiltForWork };
  const task = { number: 1, sentence: 'shared', parts: [{ id: 1, who: 'mara' }, { id: 2, who: 'otto' }] };
  const after = { ...task, parts: [...task.parts, { id: 3, who: 'otto', sentence: 'more' }] };
  const synced = [];
  projectsEngine.readAll = () => [{ id: 'p9178', name: 'p9178', agents: members, tasks: [task], made: { via: 'screen', by: null } }];
  projectsEngine.syncAgent = (who, roster, opts) => { synced.push([who, !!(opts && opts.byOther)]); return { state: projectsEngine.TOLD.TOLD, changed: true }; };
  tasksEngine.addPart = () => ({ ok: true, task: after });
  tasksEngine.assignPart = () => ({ ok: true, task: { ...task, parts: [{ id: 1, who: 'mara' }, { id: 2, who: 'otto' }] }, changed: true, previous: null });
  tasksEngine.droppedBuiltForWork = () => dropped;
  t.after(() => { Object.assign(projectsEngine, { readAll: real.readAll, syncAgent: real.syncAgent }); Object.assign(tasksEngine, { addPart: real.addPart, assignPart: real.assignPart, droppedBuiltForWork: real.droppedBuiltForWork }); board.restore(); });
  return { synced, mara: sendertoken.mint('mara').token };
}
const owed = (synced) => Object.fromEntries(synced.map(([who, byOther]) => [who, byOther]));

test('#9178: a part added from the screen drops the mark, so the other holder is owed a re-read, the new part\'s holder is not', async (t) => {
  const w = world(t);
  const r = await call('POST', '/api/project/p9178/task/1/parts', { headers: screen(), body: { sentence: 'more', who: 'otto' } });
  assert.equal(r.code, 200, r.text);
  assert.deepEqual(owed(w.synced), { mara: true, otto: false });
});

test('#9178: a part added by an agent is not news to that agent, nor to the new holder', async (t) => {
  const w = world(t);
  const r = await call('POST', '/api/project/p9178/task/1/parts', { headers: withBoard(asAgent(w.mara)), body: { sentence: 'more', who: 'otto' } });
  assert.equal(r.code, 200, r.text);
  assert.deepEqual(owed(w.synced), { mara: false, otto: false });
});

test('#9178 control: a part added where no built mark was dropped owes nobody a re-read (#8989 as before)', async (t) => {
  const w = world(t, { dropped: false });
  const r = await call('POST', '/api/project/p9178/task/1/parts', { headers: screen(), body: { sentence: 'more', who: 'otto' } });
  assert.equal(r.code, 200, r.text);
  assert.deepEqual(owed(w.synced), { mara: false, otto: false });
});

test('#9178: a part given open from the screen drops the mark: the other holder is owed a re-read, the assignee is not', async (t) => {
  const w = world(t);
  const r = await call('POST', '/api/project/p9178/task/1/part/2/who', { headers: screen(), body: { who: 'otto' } });
  assert.equal(r.code, 200, r.text);
  assert.deepEqual(owed(w.synced), { mara: true, otto: false });
});

test('#9178 control: a give that dropped no mark owes nobody a re-read', async (t) => {
  const w = world(t, { dropped: false });
  const r = await call('POST', '/api/project/p9178/task/1/part/2/who', { headers: screen(), body: { who: 'otto' } });
  assert.equal(r.code, 200, r.text);
  assert.deepEqual(owed(w.synced), { mara: false, otto: false });
});

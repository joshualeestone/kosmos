'use strict';
require('./test-support/tmpscope'); // required first in every suite file (#9104)

/**
 * kosmos#9176 review 4: an agent's instruction block marks a task built for that agent, so the task built route
 * re-syncs every holder when a set or a clear changed the mark, owing a re-read to each one the change did not come
 * from. Same sandboxed harness as server.reread-close-8989.test.js: the write and projects.syncAgent are stubbed, and
 * what each holder's sync was asked is recorded.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-builtsync-9176-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TASK_MSG_CAP = '0';   // no task message goes out for a mark; only the sync is under test

const { start, server, boardAuthState } = require('./server');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');
const projectsEngine = require('./engine/projects');
const tasksEngine = require('./engine/tasks');

const BOARD = 'BOARDTOKEN_test_9176_builtsync_0123456789abcd';
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

/* mara and otto both hold a part of task 1 on p9176. The mark is recorded, not made; `changed` says whether it changed. */
function world(t, { changed = true, built = false } = {}) {
  const members = ['mara', 'otto'];
  const board = fleet.install(members.map((m) => fleet.agent(m, { state: 'idle' })));
  const real = { readAll: projectsEngine.readAll, syncAgent: projectsEngine.syncAgent, setBuilt: tasksEngine.setBuilt, clearBuilt: tasksEngine.clearBuilt, setRepeat: tasksEngine.setRepeat };
  const task = { number: 1, sentence: 'shared', parts: [{ id: 1, who: 'mara' }, { id: 2, who: 'otto' }], ...(built ? { builtAt: '2026-11-26T12:00:00Z', builtWho: ['mara'] } : {}) };
  const synced = [];
  projectsEngine.readAll = () => [{ id: 'p9176', name: 'p9176', agents: members, tasks: [task], made: { via: 'screen', by: null } }];
  projectsEngine.syncAgent = (who, roster, opts) => { synced.push([who, !!(opts && opts.byOther)]); return { state: projectsEngine.TOLD.TOLD, changed: true }; };
  // A new mark (waitsOnly false), so the route's whole new-mark path runs; the task message cap is 0, so nothing is typed.
  tasksEngine.setBuilt = () => ({ ok: true, changed, task: { ...task, builtAt: '2026-11-26T12:00:00Z', builtWho: ['mara'] } });
  // A repeat rule on a built task drops the mark (as tasks.setRepeat does).
  tasksEngine.setRepeat = () => { const { builtAt: _b, builtWho: _w, ...rest } = task; return { ...rest, repeat: { every: 'day' } }; };
  tasksEngine.clearBuilt = () => ({ ok: true, changed, task });
  t.after(() => { Object.assign(projectsEngine, { readAll: real.readAll, syncAgent: real.syncAgent }); Object.assign(tasksEngine, { setBuilt: real.setBuilt, clearBuilt: real.clearBuilt, setRepeat: real.setRepeat }); board.restore(); });
  return { synced, mara: sendertoken.mint('mara').token };
}

test('#9176: an agent marking a shared task built re-syncs both holders, owing a re-read only to the other one', async (t) => {
  const w = world(t);
  const r = await call('POST', '/api/project/p9176/task/1/built', { headers: asAgent(w.mara), body: { note: 'done' } });
  assert.equal(r.code, 200, r.code + ' ' + r.text.slice(0, 200));
  assert.deepEqual(w.synced.sort(), [['mara', false], ['otto', true]]);
});

test('#9176: the person clearing the mark re-syncs every holder, owing each a re-read', async (t) => {
  const w = world(t);
  const r = await call('POST', '/api/project/p9176/task/1/built', { headers: screen(), body: { clear: true } });
  assert.equal(r.code, 200, r.code + ' ' + r.text.slice(0, 200));
  assert.deepEqual(w.synced.sort(), [['mara', true], ['otto', true]]);
});

test('#9176 CONTROL: a mark that changed nothing syncs nobody', async (t) => {
  const w = world(t, { changed: false });
  const r = await call('POST', '/api/project/p9176/task/1/built', { headers: asAgent(w.mara), body: { note: 'done' } });
  assert.equal(r.code, 200, r.code + ' ' + r.text.slice(0, 200));
  assert.deepEqual(w.synced, []);
});

test('#9176 review 5: a repeat rule that drops a built mark re-syncs every holder', async (t) => {
  const w = world(t, { built: true });
  const r = await call('POST', '/api/project/p9176/task/1/repeat', { headers: asAgent(w.mara), body: { every: 'day' } });
  assert.equal(r.code, 200, r.code + ' ' + r.text.slice(0, 200));
  assert.deepEqual(w.synced.sort(), [['mara', false], ['otto', true]]);
});

test('#9176 review 5 CONTROL: a repeat rule on a task that was not built syncs nobody for the mark', async (t) => {
  const w = world(t, { built: false });
  const r = await call('POST', '/api/project/p9176/task/1/repeat', { headers: asAgent(w.mara), body: { every: 'day' } });
  assert.equal(r.code, 200, r.code + ' ' + r.text.slice(0, 200));
  assert.deepEqual(w.synced, []);
});

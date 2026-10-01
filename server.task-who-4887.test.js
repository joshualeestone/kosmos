'use strict';

/**
 * #4887: POST /api/project/:id/tasks with `who` from `kosmos task add --who <agent>`. `me` is the caller (its token,
 * as "added by" names it), a name is matched to a member by store key when it is not exact, and a caller nobody can
 * name gets a 400 for `me` with nothing made. The CLIs' half is cli.task-who-4887.test.js.
 *
 * Same harness as server.agent-writes-4491.test.js: the board boots fully sandboxed, enforcement is flipped on in
 * memory, and the task engine's create is recorded, not run.
 *
 *   node --test server.task-who-4887.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskwho-4887-'));
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

const BOARD = 'BOARDTOKEN_test_4887_taskwho_0123456789abcdef';
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

async function add(headers, body) {
  const res = await fetch(base + '/api/project/p4887/tasks', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => '');
  return { code: res.status, text };
}
const asAgent = (t) => ({ 'x-kosmos-agent-token': t });
const asBoard = { 'x-kosmos-board-token': BOARD };

/* mara and otto are on p4887; the `who` each create was asked for is recorded. */
function world(t) {
  const board = fleet.install([fleet.agent('mara', { state: 'idle' }), fleet.agent('otto', { state: 'idle' })]);
  const real = { readAll: projectsEngine.readAll, create: tasksEngine.create };
  const made = [];
  projectsEngine.readAll = () => [{ id: 'p4887', name: 'p4887', agents: ['mara', 'otto'], tasks: [], made: { via: 'screen', by: null } }];
  tasksEngine.create = (id, fields) => { made.push({ who: fields.who, by: fields.made.by }); return { number: made.length, sentence: fields.sentence, who: fields.who || null }; };
  t.after(() => { Object.assign(projectsEngine, { readAll: real.readAll }); Object.assign(tasksEngine, { create: real.create }); board.restore(); });
  return { made, mara: sendertoken.mint('mara').token };
}

test('CONTROL: an add with no who reaches the engine with no who (nothing below is a default)', async (t) => {
  const w = world(t);
  const r = await add(asAgent(w.mara), { sentence: 'plain' });
  assert.equal(r.code, 200, r.text.slice(0, 160));
  assert.deepEqual(w.made, [{ who: undefined, by: 'mara' }]);
});

test('who "me" is the calling agent, in any case', async (t) => {
  const w = world(t);
  assert.equal((await add(asAgent(w.mara), { sentence: 'mine', who: 'me' })).code, 200);
  assert.equal((await add(asAgent(w.mara), { sentence: 'mine too', who: ' Me ' })).code, 200);
  assert.deepEqual(w.made.map((m) => m.who), ['mara', 'mara']);
});

test('who "me" from a caller nobody can name is a 400 that says to name the agent, and nothing is made', async (t) => {
  const w = world(t);
  const r = await add(asBoard, { sentence: 'whose?', who: 'me' });
  assert.equal(r.code, 400, r.text.slice(0, 160));
  assert.match(JSON.parse(r.text).error, /could not tell which agent you are.*name the agent instead/);
  assert.deepEqual(w.made, []);
});

test('a name in another case is matched to the member; an exact name is passed as is', async (t) => {
  const w = world(t);
  assert.equal((await add(asAgent(w.mara), { sentence: 'for otto', who: 'Otto' })).code, 200);
  assert.equal((await add(asAgent(w.mara), { sentence: 'for otto again', who: 'otto' })).code, 200);
  assert.deepEqual(w.made.map((m) => m.who), ['otto', 'otto']);
});

test('a name that matches no member is passed through as typed, for the engine to refuse', async (t) => {
  const w = world(t);
  assert.equal((await add(asAgent(w.mara), { sentence: 'for nobody', who: 'Zed' })).code, 200);
  assert.deepEqual(w.made.map((m) => m.who), ['Zed'], 'an unmatched name was rewritten instead of being left for the engine');
});

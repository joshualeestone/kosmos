'use strict';

/**
 * #8464 item 2: POST /api/project/:id/task/:n/check reports how one done-when check went. The engine rules are in
 * engine/tasks.checkresults-8464.test.js; this proves the HTTP surface: an agent on the project reports with its own
 * token and the report is recorded as its; an agent not on the project, the screen and an unnamed caller are refused
 * (403); a bad body is a 400, a missing check or a closed task a 409, a missing task a 404.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.task-check-8464.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-checkressrv-'));
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
const report = (id, n, body, headers) => post(`/api/project/${encodeURIComponent(id)}/task/${n}/check`, body, headers);
const results = (id, n) => tasks.checkResultsOf(tasks.byNumber(projects.readAll().find((x) => x.id === id), n));
function freshTask(fields = {}) {
  const p = projects.create({ name: 'Check ' + Math.random().toString(36).slice(2) });
  projects.mutate(p.id, (x) => ({ ...x, agents: ['mara'] }));
  return { id: p.id, n: tasks.create(p.id, { sentence: 'Write the copy', made: { via: 'process', by: 'mara' }, doneWhen: ['it builds', 'it is on the page'], ...fields }).number };
}
const BOARD = 'BOARDTOKEN_test_8464_checkres_0123456789abcd';
function agents(t) {
  const board = fleet.install([fleet.agent('mara', { state: 'idle' }), fleet.agent('otto', { state: 'idle' })]);
  const was = { on: boardAuthState.on, token: boardAuthState.token };
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  t.after(() => { boardAuthState.on = was.on; boardAuthState.token = was.token; board.restore(); });
  return { mara: sendertoken.mint('mara').token, otto: sendertoken.mint('otto').token };
}
const SCREEN = { 'sec-fetch-site': 'same-origin' };

test('an agent on the project reports a check with its own token, recorded as its', async (t) => {
  const { id, n } = freshTask();
  const tok = agents(t);
  const w = await report(id, n, { check: 2, met: true, how: 'opened it in the browser' }, { 'x-kosmos-agent-token': tok.mara });
  assert.equal(w.status, 200, JSON.stringify(w.json));
  assert.equal(w.json.changed, true);
  const r = results(id, n);
  assert.equal(r[0], null);
  assert.deepEqual([r[1].met, r[1].how, r[1].by], [true, 'opened it in the browser', 'mara']);
});

test('an agent not on the project is refused (403) and nothing is stored', async (t) => {
  const { id, n } = freshTask();
  const tok = agents(t);
  const w = await report(id, n, { check: 1, met: true, how: 'x' }, { 'x-kosmos-agent-token': tok.otto });
  assert.equal(w.status, 403, JSON.stringify(w.json));
  assert.match(w.json.error, /not on this project, so it cannot report on its tasks/);
  assert.deepEqual(results(id, n), [null, null]);
});

test('the screen and an unnamed caller are refused (403); the agent with screen headers is still the agent (control)', async (t) => {
  const { id, n } = freshTask();
  const screen = await report(id, n, { check: 1, met: true, how: 'x' }, SCREEN);
  assert.equal(screen.status, 403, JSON.stringify(screen.json));
  const unnamed = await report(id, n, { check: 1, met: true, how: 'x' });
  assert.equal(unnamed.status, 403, JSON.stringify(unnamed.json));
  assert.deepEqual(results(id, n), [null, null]);
  const tok = agents(t);
  const w = await report(id, n, { check: 1, met: false, how: 'fails on Linux' }, { 'x-kosmos-agent-token': tok.mara, ...SCREEN });
  assert.equal(w.status, 200, JSON.stringify(w.json));
  assert.equal(results(id, n)[0].met, false);
});

test('a bad body is a 400, a missing check or closed task a 409, a missing task a 404', async (t) => {
  const { id, n } = freshTask();
  const tok = agents(t);
  const h = { 'x-kosmos-agent-token': tok.mara };
  for (const body of [{ check: 1, met: 'yes', how: 'x' }, { check: '1', met: true, how: 'x' }, { check: 1, met: true }, []]) {
    assert.equal((await report(id, n, body, h)).status, 400, JSON.stringify(body));
  }
  const none = await report(id, n, { check: 3, met: true, how: 'x' }, h);
  assert.equal(none.status, 409); assert.match(none.json.error, /no check 3/);
  assert.equal((await report(id, 999, { check: 1, met: true, how: 'x' }, h)).status, 404);
  tasks.close(id, n);
  assert.equal((await report(id, n, { check: 1, met: true, how: 'x' }, h)).status, 409);
  assert.deepEqual(results(id, n), [null, null]);
});

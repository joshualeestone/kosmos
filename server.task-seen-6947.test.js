'use strict';
/**
 * #6947 (agent feedback 10-22): an agent that left a nudge on a task cannot tell "not seen" from "seen, not acted on".
 * The person's page posts POST /api/project/<id>/task/<n>/seen when it opens a task's page (engine/taskseen.js says
 * what that counts and misses), and `kosmos task activity` (GET .../activity?words=1) answers seenByPerson.
 * Same harness as server.task-activity-5874.test.js: a sandboxed board, enforcement on in memory, projects stubbed.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskseen-6947-'));
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
const projectsEngine = require('./engine/projects');
const taskchat = require('./engine/taskchat');
const taskseen = require('./engine/taskseen');

const BOARD = 'BOARDTOKEN_test_6947_taskseen_0123456789abcd';
const GATE_REFUSAL = /this board belongs to the account that started it/;
let base;
let agentToken;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  const a = sendertoken.mint('nudger-agent');
  assert.ok(a.ok, 'could not mint the agent token for the test');
  agentToken = a.token;
  assert.ok(taskchat.record('p6947', 1, { kind: 'created', who: 'nudger-agent' }));
  assert.ok(taskchat.record('p6947', 1, { kind: 'said', text: 'blocked on an access grant: can you add me?' }));
});
test.after(() => {
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function call(p, { method = 'GET', headers = {} } = {}) {
  const res = await fetch(base + p, { method, redirect: 'manual', headers });
  return { code: res.status, text: await res.text().catch(() => '') };
}
const asAgent = (t) => ({ 'x-kosmos-agent-token': t });
const asBoard = { 'x-kosmos-board-token': BOARD };
// What the person's page sends: the board's own gate, plus the browser's fetch metadata (server.js isViaScreen).
const asPage = { ...asBoard, 'sec-fetch-site': 'same-origin' };

function withProjects(t) {
  const realAll = projectsEngine.readAll;
  const stored = [{ id: 'p6947', name: 'p6947', agents: ['nudger-agent'], tasks: [
    { number: 1, sentence: 'needs an access grant', state: 'open' },
    { number: 2, sentence: 'nobody owns this', state: 'open' },
  ] }];
  projectsEngine.readAll = () => stored;
  t.after(() => { projectsEngine.readAll = realAll; });
}
const seenOf = async (n) => JSON.parse((await call('/api/project/p6947/task/' + n + '/activity?words=1', { headers: asAgent(agentToken) })).text).seenByPerson;

test('#6947 CONTROL: the seen route is behind the board gate like every other route', async () => {
  assert.ok(GATE_REFUSAL.test((await call('/api/project/p6947/task/1/seen', { method: 'POST' })).text));
});

test('#6947: before the person opens it, the agent reads seenByPerson null; after, the time it was opened', async (t) => {
  withProjects(t);
  assert.equal(await seenOf(2), null, 'a task the person never opened reads as not seen');
  const before = Date.now();
  const r = await call('/api/project/p6947/task/2/seen', { method: 'POST', headers: asPage });
  assert.equal(r.code, 200, r.text);
  const at = JSON.parse(r.text).seenAt;
  assert.ok(Date.parse(at) >= before - 1000, 'seenAt is now: ' + at);
  assert.equal(await seenOf(2), at, 'the agent reads the time the page recorded');
  assert.equal(await seenOf(1), null, 'opening one task does not mark another');
});

test('#6947: an agent cannot mark a task seen, with its own token or with the shared board token alone', async (t) => {
  withProjects(t);
  const withToken = await call('/api/project/p6947/task/1/seen', { method: 'POST', headers: { ...asPage, ...asAgent(agentToken) } });
  assert.equal(withToken.code, 403, withToken.text);
  // An agent on this Mac can read the homedir-shared board token; without the page's browser headers it is not the page.
  const boardOnly = await call('/api/project/p6947/task/1/seen', { method: 'POST', headers: asBoard });
  assert.equal(boardOnly.code, 403, boardOnly.text);
  assert.equal(taskseen.seenAt('p6947', 1), null);
});

test('#6947: an unknown task or project is 404 and records nothing', async (t) => {
  withProjects(t);
  assert.equal((await call('/api/project/p6947/task/99/seen', { method: 'POST', headers: asPage })).code, 404);
  assert.equal((await call('/api/project/nope/task/1/seen', { method: 'POST', headers: asPage })).code, 404);
  assert.equal(taskseen.seenAt('p6947', 99), null);
});

test('#6947: the page\'s own activity read (no words) is unchanged, and the seen record is not in task-chats', async (t) => {
  withProjects(t);
  assert.equal((await call('/api/project/p6947/task/1/seen', { method: 'POST', headers: asPage })).code, 200);
  const plain = JSON.parse((await call('/api/project/p6947/task/1/activity', { headers: asBoard })).text);
  assert.equal('seenByPerson' in plain, false, 'the page read carries no new field');
  // The room's progress allowance counts recently written files in task-chats as steps forward; opening is not one.
  const chats = fs.readdirSync(taskchat.taskChatsDir());
  assert.ok(chats.every((f) => f.endsWith('.jsonl')), 'something other than a conversation landed in task-chats: ' + chats.join(', '));
  assert.ok(fs.readdirSync(taskseen.seenDir()).some((f) => f.startsWith('p6947.task-1')), 'CONTROL: the seen record was written');
});

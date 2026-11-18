'use strict';

/**
 * kosmos#8664: POST /api/project/:id/task/:n/text changes a task's title, its detail, or both, after it is made
 * (`kosmos task edit`). This proves the HTTP surface on a real board: the new words are stored and read back through
 * /api/tasks (what `kosmos task list` and `task show` read), the change is in the task's activity with the old and new
 * words and who made it, an edit that changes nothing records nothing, and bad requests are refused without a change
 * (400 for words, 404 for no such task, 403 for an agent not on the project).
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.task-edit-8664.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskedit-'));
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
const taskchat = require('./engine/taskchat');
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
const edit = (id, n, body, headers) => post(`/api/project/${encodeURIComponent(id)}/task/${n}/text`, body, headers);
async function listed(id, n) {
  const body = await (await fetch(`${base}/api/tasks?project=${encodeURIComponent(id)}`)).json();
  return body.tasks.find((x) => x.projectId === id && x.number === n);
}
const edits = (id, n) => taskchat.read(id, n).filter((r) => r.kind === 'edited');
function freshTask(fields = {}) {
  const p = projects.create({ name: 'Edit ' + Math.random().toString(36).slice(2) });
  return { id: p.id, n: tasks.create(p.id, { sentence: 'Fix login', detail: 'old detail', made: { via: 'process', by: 'mara' }, ...fields }).number };
}

test('a new title is stored, read back by task list, and recorded with the old words', async () => {
  const { id, n } = freshTask();
  const w = await edit(id, n, { sentence: '  Fix login on iPhone  ' });
  assert.equal(w.status, 200, JSON.stringify(w.json));
  const t = await listed(id, n);
  assert.equal(t.sentence, 'Fix login on iPhone');
  assert.equal(t.detail, 'old detail', 'a title edit changed the detail');
  const rows = edits(id, n);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fromTitle, 'Fix login');
  assert.equal(rows[0].title, 'Fix login on iPhone');
  assert.equal(rows[0].detail, undefined, 'a title edit recorded a detail change');
});

test('a detail can be changed, keeping its lines, and cleared; the title is left as it was', async () => {
  const { id, n } = freshTask();
  assert.equal((await edit(id, n, { detail: 'line one\nline two' })).status, 200);
  let t = await listed(id, n);
  assert.equal(t.detail, 'line one\nline two');
  assert.equal(t.sentence, 'Fix login', 'a detail edit changed the title');
  assert.equal((await edit(id, n, { detail: null })).status, 200);
  t = await listed(id, n);
  assert.equal(t.detail || null, null, 'the detail was not cleared');
  const rows = edits(id, n);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].fromDetail, 'old detail');
  assert.equal(rows[1].detailCleared, true);
});

test('CONTROL: an edit to the words a task already has records nothing', async () => {
  const { id, n } = freshTask();
  assert.equal((await edit(id, n, { sentence: 'Fix login', detail: 'old detail' })).status, 200);
  assert.equal(edits(id, n).length, 0, 'an edit that changed nothing was recorded');
  assert.equal((await edit(id, n, { sentence: 'Fix it' })).status, 200);
  assert.equal(edits(id, n).length, 1, 'the control: a real change was not recorded');
});

test('bad requests are refused, and nothing changes', async () => {
  const { id, n } = freshTask();
  for (const [body, status, re] of [
    [{}, 400, /say the new title, the new detail, or both/],
    [{ sentence: '   ' }, 400, /a task needs a title/],
    [{ sentence: 'x'.repeat(201) }, 400, /200 characters or fewer/],
    [{ detail: 'y'.repeat(2001) }, 400, /2000 characters or fewer/],
    [{ sentence: 42 }, 400, /a task needs a title/],
  ]) {
    const w = await edit(id, n, body);
    assert.equal(w.status, status, JSON.stringify(body) + ' ' + JSON.stringify(w.json));
    assert.match(w.json.error, re);
  }
  assert.equal((await edit(id, 999, { sentence: 'no task' })).status, 404);
  const t = await listed(id, n);
  assert.equal(t.sentence, 'Fix login');
  assert.equal(t.detail, 'old detail');
  assert.equal(edits(id, n).length, 0);
});

/* The agent arms: enforcement on, as server.task-donewhen-5152.test.js runs them. mara is on the project, otto is not. */
const BOARD = 'BOARDTOKEN_test_8664_taskedit_0123456789abcdef';
function agents(t) {
  const board = fleet.install([fleet.agent('mara', { state: 'idle' }), fleet.agent('otto', { state: 'idle' })]);
  const was = { on: boardAuthState.on, token: boardAuthState.token };
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  t.after(() => { boardAuthState.on = was.on; boardAuthState.token = was.token; board.restore(); });
  return { mara: sendertoken.mint('mara').token, otto: sendertoken.mint('otto').token };
}

test('an agent on the project edits with its own token and is named in the activity; one not on it is refused (403)', async (t) => {
  const { id, n } = freshTask();
  projects.mutate(id, (p) => ({ ...p, agents: ['mara'] }));
  const tok = agents(t);
  const refused = await edit(id, n, { sentence: 'not mine' }, { 'x-kosmos-agent-token': tok.otto });
  assert.equal(refused.status, 403, JSON.stringify(refused.json));
  assert.match(refused.json.error, /not on this project, so it cannot change its tasks/);
  assert.equal(tasks.byNumber(projects.readAll().find((p) => p.id === id), n).sentence, 'Fix login', 'a refused agent changed the title');
  const ok = await edit(id, n, { sentence: 'Fixed by mara' }, { 'x-kosmos-agent-token': tok.mara });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(edits(id, n).pop().by, 'mara', 'the edit was not recorded as the token\'s agent');
});

test('an edit from the screen is recorded as the person\'s', async () => {
  const { id, n } = freshTask();
  const w = await edit(id, n, { sentence: 'From the screen' }, { 'sec-fetch-site': 'same-origin' });
  assert.equal(w.status, 200, JSON.stringify(w.json));
  const row = edits(id, n).pop();
  assert.equal(row.person, true);
  assert.equal(row.by, undefined);
});

test('a new title is told to the task\'s assignee (its instruction block lists the title); a detail-only edit tells nobody', async () => {
  const pr = projects.create({ name: 'Edit told ' + Math.random().toString(36).slice(2) });
  projects.mutate(pr.id, (p) => ({ ...p, agents: ['mara'] }));
  const id = pr.id;
  const n = tasks.create(id, { sentence: 'Fix login', detail: 'old detail', who: 'mara', made: { via: 'process', by: 'mara' } }).number;
  assert.deepEqual(tasks.whoOf(tasks.byNumber(projects.readAll().find((x) => x.id === id), n)), ['mara'], 'fixture: mara is not on the task');
  const told = [];
  const real = projects.syncAgent;
  projects.syncAgent = (name) => { told.push(name); return { state: 'skipped' }; };
  try {
    const d = await edit(id, n, { detail: 'only the detail' });
    assert.equal(d.status, 200, JSON.stringify(d.json));
    assert.deepEqual(told, [], 'a detail-only edit re-synced the assignee');
    const t = await edit(id, n, { sentence: 'A new title for mara' });
    assert.equal(t.status, 200, JSON.stringify(t.json));
    assert.deepEqual(told, ['mara'], 'the assignee was not told the new title');
  } finally { projects.syncAgent = real; }
  assert.match(tasks.forAgent(tasks.byNumber(projects.readAll().find((p) => p.id === id), n)), /A new title for mara/);
});

test('a title sent with line breaks is stored as one line (a title is one line wherever it is shown)', async () => {
  const { id, n } = freshTask();
  assert.equal((await edit(id, n, { sentence: 'Fix\nlogin\r\non\tiPhone' })).status, 200);
  assert.equal((await listed(id, n)).sentence, 'Fix login on iPhone');
});

test('a title made only of control characters is refused as empty, not stored as an empty title', async () => {
  const { id, n } = freshTask();
  for (const sentence of ['\u0001', '\u0001\u0002', ' \u0007 ']) {
    const w = await edit(id, n, { sentence });
    assert.equal(w.status, 400, JSON.stringify(sentence) + ' ' + JSON.stringify(w.json));
    assert.match(w.json.error, /a task needs a title/);
  }
  assert.equal((await listed(id, n)).sentence, 'Fix login');
  assert.equal(edits(id, n).length, 0);
});

test('a closed task can be edited (renaming it changes no work), and the edit is recorded', async () => {
  const { id, n } = freshTask();
  tasks.close(id, n);
  assert.ok((await listed(id, n)).closedAt, 'fixture: the task did not close');
  const w = await edit(id, n, { sentence: 'Fixed login, as it turned out' });
  assert.equal(w.status, 200, JSON.stringify(w.json));
  assert.equal((await listed(id, n)).sentence, 'Fixed login, as it turned out');
  assert.equal(edits(id, n).length, 1);
});

test('a task the person wrote is theirs to reword: an agent and an unnamed process are refused (403), the screen is not', async (t) => {
  const pr = projects.create({ name: 'Edit person ' + Math.random().toString(36).slice(2) });
  projects.mutate(pr.id, (p) => ({ ...p, agents: ['mara'] }));
  const id = pr.id;
  const n = tasks.create(id, { sentence: 'The person asked for this', made: { via: 'screen' } }).number;
  const tok = agents(t);
  for (const headers of [{ 'x-kosmos-agent-token': tok.mara }, { 'x-kosmos-board-token': BOARD }]) {   // an agent, and an unnamed process with the board token
    const w = await edit(id, n, { sentence: 'What I did instead' }, headers);
    assert.equal(w.status, 403, JSON.stringify(headers) + ' ' + JSON.stringify(w.json));
    assert.match(w.json.error, /the person wrote this task's words, so only they can change them/);
  }
  assert.equal(tasks.byNumber(projects.readAll().find((x) => x.id === id), n).sentence, 'The person asked for this', 'a refused caller changed the person\'s words');
  const screen = await edit(id, n, { sentence: 'The person reworded it' }, { 'sec-fetch-site': 'same-origin', 'x-kosmos-board-token': BOARD });
  assert.equal(screen.status, 200, 'CONTROL: the person could not reword their own task: ' + JSON.stringify(screen.json));
});

test('once the person rewords an agent\'s task, its words are the person\'s: the agent is refused after that', async (t) => {
  const pr = projects.create({ name: 'Edit taken ' + Math.random().toString(36).slice(2) });
  projects.mutate(pr.id, (p) => ({ ...p, agents: ['mara'] }));
  const id = pr.id;
  const n = tasks.create(id, { sentence: 'mara added this', made: { via: 'process', by: 'mara' } }).number;
  const tok = agents(t);
  assert.equal((await edit(id, n, { sentence: 'mara fixed her own title' }, { 'x-kosmos-agent-token': tok.mara })).status, 200, 'CONTROL: an agent could not edit an agent\'s task');
  assert.equal((await edit(id, n, { detail: 'the person adds a detail' }, { 'sec-fetch-site': 'same-origin', 'x-kosmos-board-token': BOARD })).status, 200);
  const after = await edit(id, n, { sentence: 'mara again' }, { 'x-kosmos-agent-token': tok.mara });
  assert.equal(after.status, 403, JSON.stringify(after.json));
});

test('the answer says whether anything changed', async () => {
  const { id, n } = freshTask();
  assert.equal((await edit(id, n, { sentence: 'Fix login' })).json.changed, false, 'an edit to the same words said it changed');
  assert.equal((await edit(id, n, { sentence: 'Fix it now' })).json.changed, true);
});

test('the activity says what changed, in the words the CLIs print', async () => {
  const { id, n } = freshTask();
  await edit(id, n, { sentence: 'Fix login on iPhone' });
  const res = await fetch(`${base}/api/project/${encodeURIComponent(id)}/task/${n}/activity?words=1`);
  const text = JSON.stringify(await res.json().catch(() => null));
  assert.match(text, /Changed the title from \\"Fix login\\" to \\"Fix login on iPhone\\"/, text.slice(0, 400));
});

'use strict';
/* kosmos#8669: POST /api/project/<id>/task/<n>/wake through the real server, and the board's own minute tick (sped up
   with AGENT_WORKFORCE_TASK_WAKE_MS). GitHub is a fake gh (AGENT_WORKFORCE_GH_BIN, the GitHub door's own switch) that
   answers each API path from a file this test writes, so a pull request can be open on one look and merged on the next.
   Setup as server.task-repeat-4787.test.js. */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-wake-srv-'));
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
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TASK_WAKE_MS = '150';
/* The fake gh: `gh api <path> ...` prints the file named for <path> under GH_ANSWERS, or a 404 as gh does. */
const GH_ANSWERS = path.join(SANDBOX, 'gh-answers');
fs.mkdirSync(GH_ANSWERS);
const FAKE_GH = path.join(SANDBOX, 'gh');
fs.writeFileSync(FAKE_GH, '#!/bin/sh\nf="' + GH_ANSWERS + '/$(printf \'%s\' "$2" | tr \'/\' \'_\')"\n'
  + 'printf \'%s\\n\' "$*" >> "' + GH_ANSWERS + '/.calls"\n'
  + '[ -f "$f" ] || { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }\ncat "$f"\n', { mode: 0o755 });
process.env.AGENT_WORKFORCE_GH_BIN = FAKE_GH;
const ghSays = (apiPath, out) => fs.writeFileSync(path.join(GH_ANSWERS, apiPath.replace(/\//g, '_')), out);
const ghCalls = () => { try { return fs.readFileSync(path.join(GH_ANSWERS, '.calls'), 'utf8').trim().split('\n').filter(Boolean); } catch { return []; } };

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const win32job = require('./engine/win32job');

let base;
let projectId;
test.before(async () => {
  win32job.setRunner(() => ({ ok: false, out: 'ERROR: The system cannot find the file specified.', code: 1 }));
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const roster = fleet.install([fleet.agent('mona', { state: 'idle' }), fleet.agent('zed', { state: 'idle' })]).agents;
  const p = projects.create({ name: 'Wake' });
  projects.addAgent(p.id, 'mona', roster);
  projectId = p.id;
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const newTask = (sentence) => tasks.create(projectId, { sentence, who: 'mona' }).number;
const stored = (n) => tasks.byNumber(projects.readAll().find((x) => x.id === projectId), n);
const post = async (p, body, headers = {}) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const screen = { 'sec-fetch-site': 'same-origin' };
const rowOf = async (n) => (await (await fetch(base + '/api/tasks?view=tasks&project=' + encodeURIComponent(projectId), { headers: screen })).json()).tasks.find((t) => t.number === n);
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await new Promise((r) => setTimeout(r, 50)); }
}

test('#8669: an agent sets a PR wake; the board looks each tick, never says met while it is open, and stores the merge', async () => {
  ghSays('repos/octo/hello/pulls/12', 'open\tfalse\n');
  const n = newTask('Re-check after the refresh');
  const mona = sendertoken.mint('mona');
  const r = await post(`/api/project/${projectId}/task/${n}/wake`, { pr: 'octo/hello#12' }, { 'x-kosmos-agent-token': mona.token });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.words, 'waits for PR #12 in octo/hello to merge or close');
  const w = stored(n).wake;
  assert.equal(w.kind, 'pr');
  assert.equal(w.setBy, 'mona');
  assert.equal((await rowOf(n)).wakeWords, 'waits for PR #12 in octo/hello to merge or close', 'the Tasks view says what it waits for');
  // Open for several ticks: looked at, never met.
  const calls0 = ghCalls().length;
  await until(() => ghCalls().length >= calls0 + 2, 3000);
  assert.ok(ghCalls().length >= calls0 + 2, 'the board looked more than once while it was open');
  assert.equal(stored(n).wakeMet, undefined, 'not met while the pull request is open');
  ghSays('repos/octo/hello/pulls/12', 'closed\ttrue\n');
  const met = await until(() => stored(n).wakeMet, 5000);
  assert.ok(met, 'the merge was found');
  assert.equal(met.words, 'it was merged');
  const row = await rowOf(n);
  assert.equal(row.wakeMetWords, 'PR #12 in octo/hello: it was merged');
  assert.equal(row.wakeWords, undefined);
  assert.ok(ghCalls().every((c) => c.startsWith('api repos/')), 'gh is only asked for the API: ' + ghCalls().slice(0, 3).join(' | '));
});

test('#8669: refusals: a merged PR, no gh, a bad target, a non-member, an unidentified process, a closed task', async () => {
  const n = newTask('Refusals');
  ghSays('repos/octo/hello/pulls/13', 'closed\ttrue\n');
  let r = await post(`/api/project/${projectId}/task/${n}/wake`, { pr: 'octo/hello#13' }, screen);
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'that pull request is already merged');
  r = await post(`/api/project/${projectId}/task/${n}/wake`, { pr: 'octo/hello#99' }, screen);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /GitHub has no pull request #99 in octo\/hello/);
  r = await post(`/api/project/${projectId}/task/${n}/wake`, { pr: 'not a pr' }, screen);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /owner\/name#123/);
  r = await post(`/api/project/${projectId}/task/${n}/wake`, { pr: 'octo/hello#12', at: '2h' }, screen);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /say one thing to wake on/);
  r = await post(`/api/project/${projectId}/task/${n}/wake`, { pr: 12 }, screen);
  assert.equal(r.status, 400);
  process.env.AGENT_WORKFORCE_GH_BIN = path.join(SANDBOX, 'no-such-gh');
  try {
    r = await post(`/api/project/${projectId}/task/${n}/wake`, { branch: 'octo/hello:main' }, screen);
    assert.equal(r.status, 400);
    assert.match(r.json.error, /GitHub is not connected on this computer/);
  } finally { process.env.AGENT_WORKFORCE_GH_BIN = FAKE_GH; }
  const zed = sendertoken.mint('zed');
  r = await post(`/api/project/${projectId}/task/${n}/wake`, { at: '2h' }, { 'x-kosmos-agent-token': zed.token });
  assert.equal(r.status, 403, 'zed is not on the project');
  r = await post(`/api/project/${projectId}/task/${n}/wake`, { at: '2h' });
  assert.equal(r.status, 403, 'a process Kosmos cannot name');
  r = await post(`/api/project/${projectId}/task/9999/wake`, { at: '2h' }, screen);
  assert.equal(r.status, 404);
  const c = newTask('Closed one');
  tasks.close(projectId, c);
  r = await post(`/api/project/${projectId}/task/${c}/wake`, { at: '2h' }, screen);
  assert.equal(r.status, 409);
  assert.equal(stored(n).wake, undefined, 'nothing was stored by any refusal');
});

test('#8669: the person\'s wake is theirs; a branch wake starts from its commit; a file wake keeps its path off the rows', async () => {
  const n = newTask('Theirs');
  let r = await post(`/api/project/${projectId}/task/${n}/wake`, { at: '3h' }, screen);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(stored(n).wake.byPerson, true);
  const mona = sendertoken.mint('mona');
  r = await post(`/api/project/${projectId}/task/${n}/wake`, { clear: true }, { 'x-kosmos-agent-token': mona.token });
  assert.equal(r.status, 403);
  assert.match(r.json.error, /only they can change it/);
  r = await post(`/api/project/${projectId}/task/${n}/wake`, { clear: true }, screen);
  assert.equal(r.status, 200);
  assert.equal(stored(n).wake, undefined);

  ghSays('repos/octo/hello/branches/main', 'a'.repeat(40) + '\n');
  const b = newTask('Branch');
  r = await post(`/api/project/${projectId}/task/${b}/wake`, { branch: 'octo/hello:main' }, { 'x-kosmos-agent-token': mona.token });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(stored(b).wake.from, 'a'.repeat(40));
  assert.equal(r.json.words, 'waits for a new commit on main in octo/hello');

  const dir = path.join(HOME, 'private-folder');   // inside the home folder, which is where a file wake may watch
  fs.mkdirSync(dir);
  const file = path.join(dir, 'brief.md');
  fs.writeFileSync(file, 'one');
  const f = newTask('File');
  r = await post(`/api/project/${projectId}/task/${f}/wake`, { file }, { 'x-kosmos-agent-token': mona.token });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(JSON.stringify(r.json).includes('private-folder'), false, 'the answer leaves the path out');
  const row = await rowOf(f);
  assert.equal(row.wakeWords, 'waits for brief.md to change');
  assert.equal(JSON.stringify(row).includes('private-folder'), false, 'the row leaves the path out');
  fs.writeFileSync(file, 'two');
  const met = await until(() => stored(f).wakeMet, 5000);
  assert.ok(met, 'the change was found');
  assert.equal(met.words, 'it changed');
});

/* Last in the file: it switches on live execution for this process. The board's own tick then tells the holder through
   its real wiring (owed, the roster, the Agent Communication gates, markTold); only the typing into a pane is stood in
   for, by chat.deliverAutomatic, which the tick calls by name at the time it tells. */
test('#8669: through the board\'s own tick, the holder is told once after the merge, and the task records it', async () => {
  const chat = require('./engine/chat');
  const selfreport = require('./engine/selfreport');
  const liveExecution = require('./engine/live-execution');
  const typed = [];
  const realDeliver = chat.deliverAutomatic;
  const realRead = selfreport.read;
  chat.deliverAutomatic = (session, text) => { typed.push({ session, text }); return { state: chat.DELIVERY.PLACED }; };
  selfreport.read = (session) => (session === 'zed' ? { found: true, state: 'idle', at: new Date(Date.now() - 120e3).toISOString() } : realRead(session));
  try {
    ghSays('repos/octo/hello/pulls/21', 'open\tfalse\n');
    /* zed's own task: earlier tests leave woken tasks for mona, and an agent hears one line a minute. */
    projects.addAgent(projectId, 'zed');
    const n = tasks.create(projectId, { sentence: 'Ship once the fix lands', who: 'zed' }).number;
    const zed = sendertoken.mint('zed');
    const r = await post(`/api/project/${projectId}/task/${n}/wake`, { pr: 'octo/hello#21' }, { 'x-kosmos-agent-token': zed.token });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    liveExecution.allowLiveExecution();
    await new Promise((res) => setTimeout(res, 800));
    assert.equal(typed.filter((x) => x.text.includes('#' + n + ' ')).length, 0, 'nobody is told while it is open');
    ghSays('repos/octo/hello/pulls/21', 'closed\ttrue\n');
    const told = await until(() => stored(n).wakeToldAt, 6000);
    assert.ok(told, 'the holder was told: ' + JSON.stringify(stored(n)));
    assert.deepEqual(stored(n).wakeTold, { who: 'zed', reached: true });
    const mine = typed.filter((x) => x.text.includes('task #' + n + ' '));
    assert.equal(mine.length, 1);
    assert.equal(mine[0].session, 'zed');
    assert.match(mine[0].text, /was waiting for PR #21 in octo\/hello to merge or close, and it was merged\. Pick it up now\./);
    await new Promise((res) => setTimeout(res, 800));
    assert.equal(typed.filter((x) => x.text.includes('task #' + n + ' ')).length, 1, 'once');
    const kinds = require('./engine/taskchat').read(projectId, n).map((e) => e.kind);
    assert.ok(kinds.includes('wake-met') && kinds.includes('wake-told'), kinds.join(','));
  } finally {
    chat.deliverAutomatic = realDeliver;
    selfreport.read = realRead;
  }
});

'use strict';
/**
 * #5874: `kosmos task activity` reads a task's conversation through GET /api/project/<id>/task/<n>/activity. On its
 * own agent token an agent reads it only for a project it is on (the GET /api/tasks rule); `?words=1` adds each event's
 * words as the page says them. Same harness as server.agent-reads-4491.test.js: a sandboxed board,
 * enforcement flipped on in memory, the project registry stubbed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskact-5874-'));
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

const BOARD = 'BOARDTOKEN_test_5874_activity_0123456789abcd';
const GATE_REFUSAL = /this board belongs to the account that started it/;
let base;
let agentToken;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  const a = sendertoken.mint('reader-agent');
  assert.ok(a.ok, 'could not mint the agent token for the test');
  agentToken = a.token;
  assert.ok(taskchat.record('p5874', 1, { kind: 'created', who: 'reader-agent' }), 'could not record the first event');
  // As the board records a message (tasks.say): no author.
  assert.ok(taskchat.record('p5874', 1, { kind: 'said', text: 'on it' }));
  assert.ok(taskchat.record('p5874', 1, { kind: 'closed' }));
  assert.ok(taskchat.record('other5874', 1, { kind: 'said', text: 'not yours' }));
});
test.after(() => {
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function call(p, headers = {}) {
  const res = await fetch(base + p, { redirect: 'manual', headers });
  return { code: res.status, text: await res.text().catch(() => '') };
}
const asAgent = (t) => ({ 'x-kosmos-agent-token': t });
const asBoard = { 'x-kosmos-board-token': BOARD };

function withProjects(t, members = ['reader-agent']) {
  const realAll = projectsEngine.readAll;
  const stored = [
    { id: 'p5874', name: 'p5874', agents: members, tasks: [{ number: 1, sentence: 'read me', state: 'open' }] },
    { id: 'other5874', name: 'other5874', agents: ['someone-else'], tasks: [{ number: 1, sentence: 'not yours', state: 'open' }] },
  ];
  projectsEngine.readAll = () => stored;
  t.after(() => { projectsEngine.readAll = realAll; });
}

test('#5874 CONTROL: the activity read is refused at the gate with no credential and with a token nobody issued', async () => {
  assert.ok(GATE_REFUSAL.test((await call('/api/project/p5874/task/1/activity')).text));
  assert.ok(GATE_REFUSAL.test((await call('/api/project/p5874/task/1/activity', asAgent('c'.repeat(64)))).text));
});

test('#5874: on its own token an agent on the project reads the task, oldest first, with words when asked', async (t) => {
  withProjects(t);
  const plain = await call('/api/project/p5874/task/1/activity', asAgent(agentToken));
  assert.equal(plain.code, 200, plain.text.slice(0, 160));
  const raw = JSON.parse(plain.text);
  assert.deepEqual(raw.events.map((e) => e.kind), ['created', 'said', 'closed']);
  assert.ok(raw.events.every((e) => !('words' in e)), 'words were added without ?words=1');
  const worded = JSON.parse((await call('/api/project/p5874/task/1/activity?words=1', asAgent(agentToken))).text);
  // No card for reader-agent on this board, so it is named by its session name, as the page's fallback does. A member's
  // card name is checked end to end in cli.task-activity-5874.test.js (a real fleet card).
  assert.deepEqual(worded.events.map((e) => e.words), ['Created and given to reader-agent', 'A message: "on it"', 'Marked done']);
  assert.equal(worded.count, 3);
});

test('#5874: on its token alone an agent not on the project is refused, and an unknown project is said', async (t) => {
  withProjects(t);
  const theirs = await call('/api/project/other5874/task/1/activity?words=1', asAgent(agentToken));
  assert.equal(theirs.code, 403, theirs.text.slice(0, 160));
  assert.doesNotMatch(theirs.text, /not yours/);
  assert.equal(JSON.parse(theirs.text).error, "that agent is not on this project, so it cannot read its tasks; ask the person to add this agent with the + beside Members on the project's page, then run the same command again");
  const none = await call('/api/project/nope5874/task/1/activity', asAgent(agentToken));
  assert.equal(none.code, 404);
  assert.match(none.text, /there is no project by that name/);
});

test('#5874: a token that names nobody is refused, and a projects read that failed is not "no such project"', async (t) => {
  withProjects(t);
  /* kosmos#5752's shape: an older key-only token whose key another name also holds names no agent. */
  const realResolveName = sendertoken.resolveName;
  sendertoken.resolveName = (tok) => (tok === agentToken ? { ok: true, key: 'otto5874', name: null, twins: true, instance: null } : realResolveName(tok));
  try {
    const nobody = await call('/api/project/p5874/task/1/activity?words=1', asAgent(agentToken));
    assert.equal(nobody.code, 403);
    assert.equal(JSON.parse(nobody.text).error, 'Kosmos could not tell which agent this token belongs to, so it cannot read this task');
  } finally { sendertoken.resolveName = realResolveName; }
  const realAll = projectsEngine.readAll;
  projectsEngine.readAll = () => { throw new Error('disk gone'); };
  try {
    const blind = await call('/api/project/p5874/task/1/activity?words=1', asAgent(agentToken));
    assert.equal(blind.code, 503, blind.text.slice(0, 160));
    assert.doesNotMatch(blind.text, /no project by that name/);
  } finally { projectsEngine.readAll = realAll; }
});

test('#5874: the board token (the page, the person) reads as before, any project', async (t) => {
  withProjects(t);
  const page = await call('/api/project/other5874/task/1/activity', asBoard);
  assert.equal(page.code, 200);
  assert.match(page.text, /not yours/);
  // The page asks without words and keeps its fail-soft empty list for a task with nothing recorded (#992).
  assert.deepEqual(JSON.parse((await call('/api/project/p5874/task/9/activity', asBoard)).text), { events: [], count: 0 });
  // The CLIs ask with words, and to them an unknown task or project is said (#4891 N6), for every caller.
  const noTask = await call('/api/project/p5874/task/9/activity?words=1', asBoard);
  assert.equal(noTask.code, 404);
  assert.equal(JSON.parse(noTask.text).error, 'there is no task 9 on that project');
  const noProject = await call('/api/project/nope5874/task/1/activity?words=1', asBoard);
  assert.equal(noProject.code, 404);
  assert.match(noProject.text, /there is no project by that name/);
});

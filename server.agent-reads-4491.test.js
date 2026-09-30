'use strict';

/**
 * #4491 slice 4: three READS an agent already makes every day with the board token (`kosmos agent roles`,
 * `kosmos task list`, `kosmos room`) are reachable with ONLY its own agent token. On that token alone the room
 * and the tasks answer only for a project the agent is on; a caller that also presents the board token (every
 * CLI today, and the person) is not narrowed. The setup guide on a Mac is such a token-only caller (its sandbox
 * keeps the board token from it) and is held to the same rule as any agent, with none of its own.
 *
 * Same harness as server.agent-token-gate-4491.test.js: the board boots fully sandboxed, then
 * enforcement is flipped on in memory, so no real store is touched.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agentreads-4491-'));
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
const setupAssistant = require('./engine/setup-assistant');
const instructions = require('./engine/instructions');
const projectsEngine = require('./engine/projects');

const BOARD = 'BOARDTOKEN_test_4491_reads_0123456789abcdef';
const GATE_REFUSAL = /this board belongs to the account that started it/;
const GUIDE = 'guide-4491';   // a created agent's name is always its own store key (create.js NAME_RE)
let base;
let agentToken;
let guideToken;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  const a = sendertoken.mint('reader-agent');
  const g = sendertoken.mint(GUIDE);
  assert.ok(a.ok && g.ok, 'could not mint the agent tokens for the test');
  agentToken = a.token;
  guideToken = g.token;
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
const asAgent = (t) => ({ headers: { 'x-kosmos-agent-token': t } });

/* Two projects, without touching a real registry: p4491 (reader-agent is on it) and other4491 (it is not). */
function withProject(t, members = ['reader-agent']) {
  const realAll = projectsEngine.readAll;
  projectsEngine.readAll = () => [
    { id: 'p4491', name: 'p4491', agents: members, tasks: [{ number: 1, sentence: 'read me', state: 'open' }] },
    { id: 'other4491', name: 'other4491', agents: ['someone-else'], tasks: [{ number: 1, sentence: 'not yours', state: 'open' }] },
  ];
  t.after(() => { projectsEngine.readAll = realAll; });
}
const READS = ['/api/roles', '/api/roles?catalogue=0', '/api/tasks?project=p4491', '/api/project/p4491/room?as=text', '/api/project/p4491/room'];
const both = (t) => ({ headers: { 'x-kosmos-agent-token': t, 'x-kosmos-board-token': BOARD } });

test('CONTROL: each read is refused at the gate with no credential, and with a well-formed token nobody issued', async () => {
  for (const p of READS) {
    assert.ok(refusedAtGate(await call('GET', p)), `the gate did not refuse a bare GET ${p}, so nothing below can be trusted`);
    assert.ok(refusedAtGate(await call('GET', p, asAgent('c'.repeat(64)))), `GET ${p} passed the gate with a token nobody issued`);
  }
});

test('the three reads answer an agent that holds only its own token, for a project it is on', async (t) => {
  withProject(t);
  const roles = await call('GET', '/api/roles', asAgent(agentToken));
  assert.equal(roles.code, 200, roles.text.slice(0, 160));
  assert.ok(Array.isArray(JSON.parse(roles.text).roles) && JSON.parse(roles.text).roles.length > 0, 'the roles read carried no roles');
  const tasks = await call('GET', '/api/tasks?project=p4491', asAgent(agentToken));
  assert.equal(tasks.code, 200, tasks.text.slice(0, 160));
  assert.match(tasks.text, /read me/, 'the tasks read did not carry the project\'s task');
  assert.doesNotMatch(tasks.text, /not yours/, 'the tasks read carried another project\'s task');
  const room = await call('GET', '/api/project/p4491/room?as=text', asAgent(agentToken));
  assert.equal(room.code, 200, 'the room read was not answered: ' + room.code + ' ' + room.text.slice(0, 160));
  /* The JSON arm (no ?as=text), the one that warms link previews: answered too, as rows. */
  const json = await call('GET', '/api/project/p4491/room', asAgent(agentToken));
  assert.equal(json.code, 200, 'the room\'s JSON arm was not answered: ' + json.code + ' ' + json.text.slice(0, 160));
  assert.ok(Array.isArray(JSON.parse(json.text).rows), 'the room\'s JSON arm carried no rows array: ' + json.text.slice(0, 160));
  /* An unknown project is the handler's own 404 sentence, so the gate let it through and the handler judged it. */
  const none = await call('GET', '/api/project/nope4491/room?as=text', asAgent(agentToken));
  assert.equal(none.code, 404);
  assert.match(none.text, /there is no project by that name/);
  assert.equal((await call('GET', '/api/tasks?project=nope4491', asAgent(agentToken))).code, 404);
});

test('on its token alone an agent reads only the room and tasks of a project it is on', async (t) => {
  withProject(t);
  const roomText = await call('GET', '/api/project/other4491/room?as=text', asAgent(agentToken));
  assert.equal(roomText.code, 403, 'a non-member read the room: ' + roomText.text.slice(0, 120));
  assert.equal(roomText.text, 'that agent is not on this project, so it cannot read its room\n', 'the text arm prints its sentence bare, for the bash CLI');
  const roomJson = await call('GET', '/api/project/other4491/room', asAgent(agentToken));
  assert.equal(roomJson.code, 403);
  assert.match(JSON.parse(roomJson.text).error, /not on this project/);
  const tasks = await call('GET', '/api/tasks?project=other4491', asAgent(agentToken));
  assert.equal(tasks.code, 403, 'a non-member read the tasks: ' + tasks.text.slice(0, 120));
  assert.doesNotMatch(tasks.text, /not yours/);
  /* Never the global set. */
  const all = await call('GET', '/api/tasks', asAgent(agentToken));
  assert.equal(all.code, 403, 'the global task list was read on an agent token alone: ' + all.text.slice(0, 120));
  assert.match(all.text, /say which project/);
  assert.doesNotMatch(all.text, /read me|not yours/);
  /* Never the Tasks view's arm: asked for it, a member gets the plain list (no roster fields). */
  const view = await call('GET', '/api/tasks?project=p4491&view=tasks&withArchived=other4491', asAgent(agentToken));
  assert.equal(view.code, 200);
  const viewed = JSON.parse(view.text);
  assert.equal(Object.prototype.hasOwnProperty.call(viewed, 'rosterUnreadable'), false, 'the Tasks view arm was served to an agent token');
  assert.ok(viewed.tasks.length === 1 && !('claim' in viewed.tasks[0]) && !('lastActivityAt' in viewed.tasks[0]), 'the Tasks view\'s fields were served: ' + view.text.slice(0, 200));
  /* CONTROL: the same agent, presenting the board token too (as every CLI does today), is not narrowed at all. */
  assert.equal((await call('GET', '/api/project/other4491/room?as=text', both(agentToken))).code, 200, 'an agent with the board token lost a room it reads today');
  const theirs = await call('GET', '/api/tasks?project=other4491', both(agentToken));
  assert.equal(theirs.code, 200);
  assert.match(theirs.text, /not yours/, 'an agent with the board token lost a task list it reads today');
  const global = await call('GET', '/api/tasks', { headers: { 'x-kosmos-board-token': BOARD } });
  assert.match(global.text, /read me[\s\S]*not yours|not yours[\s\S]*read me/, 'the board token no longer reads the global task list');
  const pageView = JSON.parse((await call('GET', '/api/tasks?project=p4491&view=tasks', { headers: { 'x-kosmos-board-token': BOARD } })).text);
  assert.ok(Object.prototype.hasOwnProperty.call(pageView, 'rosterUnreadable'), 'control: the Tasks view arm is still served to the board token, so the absence above is the narrowing');
});

test('a token for a name no project lists reads no room and no tasks; a projects list that cannot be read is a 503 for it', async (t) => {
  withProject(t);
  const stray = sendertoken.mint('stray-4491');
  assert.ok(stray.ok);
  t.after(() => sendertoken.revoke('stray-4491'));
  assert.equal((await call('GET', '/api/project/p4491/room?as=text', asAgent(stray.token))).code, 403);
  assert.equal((await call('GET', '/api/tasks?project=p4491', asAgent(stray.token))).code, 403);
  assert.equal((await call('GET', '/api/roles', asAgent(stray.token))).code, 200, 'the roles list is open to any valid token');
  /* Unreadable registry: the member cannot be checked, so the token-only read is refused (503), while the board
     token keeps the room's old fail-open read. */
  const stubbed = projectsEngine.readAll;
  projectsEngine.readAll = () => { throw new Error('unreadable'); };
  try {
    const blind = await call('GET', '/api/project/p4491/room?as=text', asAgent(agentToken));
    assert.equal(blind.code, 503, 'an unreadable projects list let a token-only read through: ' + blind.code);
    assert.equal((await call('GET', '/api/project/p4491/room?as=text', { headers: { 'x-kosmos-board-token': BOARD } })).code, 200, 'the board token lost the room\'s fail-open read');
    /* The task list reads the projects before anything else, so it answers its own 500 for every caller. Closed, not open. */
    const blindTasks = await call('GET', '/api/tasks?project=p4491', asAgent(agentToken));
    assert.equal(blindTasks.code, 500, 'an unreadable projects list did not stop the token-only task read: ' + blindTasks.code);
    assert.doesNotMatch(blindTasks.text, /read me/);
  } finally { projectsEngine.readAll = stubbed; }   // back to withProject's list, which its own t.after then undoes
});

test('a board token that is WRONG does not lift the narrowing: the caller still came through on its agent token', async (t) => {
  withProject(t);
  for (const junk of [{ 'x-kosmos-board-token': 'not-the-board-token' }, { cookie: 'kosmos_board=not-the-board-token' }, { 'x-kosmos-board-token': '' }]) {
    const h = { headers: { 'x-kosmos-agent-token': agentToken, ...junk } };
    const label = JSON.stringify(junk);
    assert.equal((await call('GET', '/api/project/other4491/room?as=text', h)).code, 403, 'a wrong board token opened another project\'s room: ' + label);
    assert.equal((await call('GET', '/api/tasks?project=other4491', h)).code, 403, 'a wrong board token opened another project\'s tasks: ' + label);
    assert.equal((await call('GET', '/api/tasks', h)).code, 403, 'a wrong board token opened the global task list: ' + label);
    assert.equal((await call('GET', '/api/project/p4491/room?as=text', h)).code, 200, 'control: the agent lost its own room: ' + label);
  }
  /* And without the agent token, a wrong board token is nobody at all. */
  assert.ok(refusedAtGate(await call('GET', '/api/project/p4491/room?as=text', { headers: { 'x-kosmos-board-token': 'not-the-board-token' } })));
});

test('membership is by the token store\'s key: a project that lists the name as written admits its token', async (t) => {
  /* A stored name that is not its own key ("Reader.Agent" is kept under "readeragent"). An exact comparison of the
     key against the stored name would refuse the agent its own project. */
  const dotted = sendertoken.mint('Reader.Agent');
  assert.ok(dotted.ok);
  t.after(() => sendertoken.revoke('Reader.Agent'));
  assert.equal(sendertoken.resolveName(dotted.token).key, 'readeragent', 'control: the store does not key this name as assumed, so the case below is not the by-key case');
  withProject(t, ['Reader.Agent']);
  assert.equal((await call('GET', '/api/project/p4491/room?as=text', asAgent(dotted.token))).code, 200, 'an agent was refused the room of a project that lists it');
  assert.equal((await call('GET', '/api/tasks?project=p4491', asAgent(dotted.token))).code, 200, 'an agent was refused the tasks of a project that lists it');
  assert.equal((await call('GET', '/api/project/other4491/room?as=text', asAgent(dotted.token))).code, 403, 'control: by-key matching admitted it to a project that does not list it');
  assert.equal((await call('GET', '/api/project/p4491/room?as=text', asAgent(agentToken))).code, 403, 'control: reader-agent is not on p4491 in this test, so it must be refused');
});

test('a project id stored twice: the agent must be on every one of them', async (t) => {
  const realAll = projectsEngine.readAll;
  projectsEngine.readAll = () => [
    { id: 'dup4491', name: 'one', agents: ['reader-agent'], tasks: [{ number: 1, sentence: 'mine', state: 'open' }] },
    { id: 'dup4491', name: 'two', agents: ['someone-else'], tasks: [{ number: 1, sentence: 'theirs', state: 'open' }] },
  ];
  t.after(() => { projectsEngine.readAll = realAll; });
  const tasks = await call('GET', '/api/tasks?project=dup4491', asAgent(agentToken));
  assert.equal(tasks.code, 403, 'a doubled id served the other project\'s tasks: ' + tasks.text.slice(0, 120));
  assert.doesNotMatch(tasks.text, /theirs/);
  assert.equal((await call('GET', '/api/project/dup4491/room?as=text', asAgent(agentToken))).code, 403);
});

test('only GET on exactly those paths: every other verb and neighbour stays behind the board token', async () => {
  const closed = [
    ['HEAD', '/api/roles'], ['HEAD', '/api/tasks'], ['HEAD', '/api/project/p4491/room'], ['POST', '/api/roles'], ['PUT', '/api/roles'], ['DELETE', '/api/tasks'],
    ['POST', '/api/project/p4491/room'], ['POST', '/api/project/p4491/room/reopen'], ['GET', '/api/project/p4491/room/reopen'],
    ['GET', '/api/project/p4491/room/'], ['GET', '/api/project/a/b/room'], ['GET', '/api/project/p4491/rooms'],
    ['POST', '/api/project/p4491/tasks'], ['GET', '/api/project/p4491/tasks'], ['POST', '/api/project/p4491/task/1/close'],
    ['GET', '/api/projects'], ['POST', '/api/projects'], ['GET', '/api/status'], ['GET', '/api/roles/x'], ['GET', '/api/tasks/1'],
  ];
  for (const [method, p] of closed) {
    const r = await call(method, p, { ...asAgent(agentToken), body: method === 'GET' || method === 'HEAD' ? undefined : {} });
    /* A HEAD answer has no body to read the sentence from: the status alone is the refusal. */
    assert.ok(method === 'HEAD' ? r.code === 403 : refusedAtGate(r), `${method} ${p} was reachable with only an agent token: ${r.code} ${r.text.slice(0, 80)}`);
  }
});

test('the setup guide is held to the same rule as any agent: its own project\'s room and tasks, and no other', async (t) => {
  withProject(t, ['reader-agent', GUIDE]);
  /* A REAL marked folder, not a stub: the folder the board would look in for this name, with the guide marker. On a
     Mac the guide is a real token-only caller (its sandbox keeps the board token from it), so this is its case. */
  const dir = path.dirname(instructions.fileFor(GUIDE));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, setupAssistant.GUIDE_MARKER), GUIDE + '\n');
  t.after(() => fs.rmSync(path.join(dir, setupAssistant.GUIDE_MARKER), { force: true }));
  assert.equal(setupAssistant.isGuideFolder(GUIDE), true, 'control: the board does not see this agent as the guide, so the reads below prove nothing about it');
  assert.equal(setupAssistant.isGuideFolder('reader-agent'), false, 'control: every agent reads as the guide');
  /* On a project it has been put on (only a process holding the board token can: the page leaves the guide out of
     every member list), it reads like any member. The marker changes nothing here, since no read consults it: this
     is here to go red if a guide-only refusal is added, so that one is a decision made on purpose (measured red
     against this branch's first version, which had one). */
  for (const p of READS) {
    const r = await call('GET', p, asAgent(guideToken));
    assert.equal(r.code, 200, `the setup guide's token was refused on ${p}, a project it is on`);
  }
  /* Off a project, nothing: the same 403s as any agent. */
  assert.equal((await call('GET', '/api/project/other4491/room?as=text', asAgent(guideToken))).code, 403, 'the guide read the room of a project it is not on');
  assert.equal((await call('GET', '/api/tasks?project=other4491', asAgent(guideToken))).code, 403, 'the guide read the tasks of a project it is not on');
  assert.equal((await call('GET', '/api/tasks', asAgent(guideToken))).code, 403, 'the guide read the global task list');
});

test('a revoked token no longer reads', async (t) => {
  withProject(t, ['reader-agent', 'gone-reader']);
  const gone = sendertoken.mint('gone-reader');
  assert.ok(gone.ok);
  assert.equal((await call('GET', '/api/tasks?project=p4491', asAgent(gone.token))).code, 200, 'control: the fresh token reads');
  sendertoken.revoke('gone-reader');
  assert.ok(refusedAtGate(await call('GET', '/api/tasks?project=p4491', asAgent(gone.token))), 'a revoked token still reads the tasks');
});

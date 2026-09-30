'use strict';

/**
 * #4491 slice 4: three READS an agent already makes every day with the board token (`kosmos roles`,
 * `kosmos task list`, `kosmos room`) are reachable with ONLY its own agent token, and the setup guide,
 * the one agent kept from the board token on purpose, gains nothing from that on the two that carry
 * people's work (the room and the tasks).
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
const projectsEngine = require('./engine/projects');

const BOARD = 'BOARDTOKEN_test_4491_reads_0123456789abcdef';
const GATE_REFUSAL = /this board belongs to the account that started it/;
const GUIDE = 'Setup Guide';   // a name whose token-store key ("setupguide") is not the name itself
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

/* One project the room read can find, without touching a real registry. */
function withProject(t) {
  const realAll = projectsEngine.readAll;
  projectsEngine.readAll = () => [{ id: 'p4491', name: 'p4491', agents: ['reader-agent'], tasks: [{ number: 1, sentence: 'read me', state: 'open' }] }];
  t.after(() => { projectsEngine.readAll = realAll; });
}
/* The guide as the board knows it: a recorded name, and a marked folder for that name only. */
function withGuide(t, { isGuideFolder = (n) => n === GUIDE, guideName = () => GUIDE } = {}) {
  const was = { isGuideFolder: setupAssistant.isGuideFolder, guideName: setupAssistant.guideName };
  setupAssistant.isGuideFolder = isGuideFolder;
  setupAssistant.guideName = guideName;
  t.after(() => { setupAssistant.isGuideFolder = was.isGuideFolder; setupAssistant.guideName = was.guideName; });
}

const READS = ['/api/roles', '/api/roles?catalogue=0', '/api/tasks?project=p4491', '/api/project/p4491/room?as=text', '/api/project/p4491/room'];
const GUIDE_CLOSED = ['/api/tasks?project=p4491', '/api/tasks', '/api/project/p4491/room?as=text', '/api/project/p4491/room'];

test('CONTROL: each read is refused at the gate with no credential, and with a well-formed token nobody issued', async () => {
  for (const p of READS) {
    assert.ok(refusedAtGate(await call('GET', p)), `the gate did not refuse a bare GET ${p}, so nothing below can be trusted`);
    assert.ok(refusedAtGate(await call('GET', p, asAgent('c'.repeat(64)))), `GET ${p} passed the gate with a token nobody issued`);
  }
});

test('the three reads answer an agent that holds only its own token', async (t) => {
  withProject(t);
  const roles = await call('GET', '/api/roles', asAgent(agentToken));
  assert.equal(roles.code, 200, roles.text.slice(0, 160));
  assert.ok(Array.isArray(JSON.parse(roles.text).roles) && JSON.parse(roles.text).roles.length > 0, 'the roles read carried no roles');
  const tasks = await call('GET', '/api/tasks?project=p4491', asAgent(agentToken));
  assert.equal(tasks.code, 200, tasks.text.slice(0, 160));
  assert.match(tasks.text, /read me/, 'the tasks read did not carry the project\'s task');
  const room = await call('GET', '/api/project/p4491/room?as=text', asAgent(agentToken));
  assert.equal(room.code, 200, 'the room read was not answered: ' + room.code + ' ' + room.text.slice(0, 160));
  /* An unknown project is the handler's own 404 sentence, so the gate let it through and the handler judged it. */
  const none = await call('GET', '/api/project/nope4491/room?as=text', asAgent(agentToken));
  assert.equal(none.code, 404);
  assert.match(none.text, /there is no project by that name/);
});

test('only GET on exactly those paths: every other verb and neighbour stays behind the board token', async () => {
  const closed = [
    ['HEAD', '/api/roles'], ['POST', '/api/roles'], ['PUT', '/api/roles'], ['DELETE', '/api/tasks'],
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

test('the setup guide\'s own token does not open the room or the tasks; the roles stay open to it', async (t) => {
  withProject(t);
  withGuide(t);
  for (const p of GUIDE_CLOSED) {
    assert.ok(refusedAtGate(await call('GET', p, asAgent(guideToken))), `the setup guide read ${p} with only its own token`);
    /* CONTROL, same board state: another agent's token still reads it, so the refusal is the guide rule. */
    assert.ok(!refusedAtGate(await call('GET', p, asAgent(agentToken))), `control: an ordinary agent was refused on ${p} while a guide exists`);
    /* And with the board token the gate never asks who the agent is. */
    assert.ok(!refusedAtGate(await call('GET', p, { headers: { 'x-kosmos-agent-token': guideToken, 'x-kosmos-board-token': BOARD } })), `the board token stopped opening ${p}`);
  }
  const roles = await call('GET', '/api/roles', asAgent(guideToken));
  assert.equal(roles.code, 200, 'the roles list is the product\'s own text and stays open to the guide: ' + roles.code);
});

test('CONTROL: the same token reads the room once nothing marks its agent as the guide', async (t) => {
  withProject(t);
  withGuide(t, { isGuideFolder: () => false, guideName: () => null });
  for (const p of GUIDE_CLOSED) {
    assert.ok(!refusedAtGate(await call('GET', p, asAgent(guideToken))), `${p} was refused though no guide is recorded: the refusal above is not the guide rule`);
  }
});

test('the guide is recognised by its folder alone (no recorded name), and by its recorded name', async (t) => {
  withProject(t);
  /* Folder only: the seed record is missing, the marker is there, asked by the token store's key. */
  withGuide(t, { isGuideFolder: (n) => n === 'setupguide', guideName: () => null });
  assert.ok(refusedAtGate(await call('GET', '/api/project/p4491/room?as=text', asAgent(guideToken))), 'a marked folder alone did not close the room to the guide');
  assert.ok(!refusedAtGate(await call('GET', '/api/project/p4491/room?as=text', asAgent(agentToken))), 'control: an ordinary agent was refused');
});

test('a recorded guide name whose folder is NOT marked closes nothing (a renamed or removed guide)', async (t) => {
  withProject(t);
  withGuide(t, { isGuideFolder: () => false, guideName: () => GUIDE });
  assert.ok(!refusedAtGate(await call('GET', '/api/project/p4491/room?as=text', asAgent(guideToken))), 'an unmarked folder was treated as the guide');
});

test('when the board cannot tell whether the caller is the guide, the two reads stay closed', async (t) => {
  withProject(t);
  withGuide(t, { isGuideFolder: () => false, guideName: () => { throw new Error('unreadable'); } });
  for (const p of GUIDE_CLOSED) {
    assert.ok(refusedAtGate(await call('GET', p, asAgent(agentToken))), `${p} opened while the guide's record could not be read`);
  }
  assert.equal((await call('GET', '/api/roles', asAgent(agentToken))).code, 200, 'the roles read does not depend on the guide check');
  assert.ok(!refusedAtGate(await call('GET', '/api/project/p4491/room?as=text', { headers: { 'x-kosmos-board-token': BOARD } })), 'the board token is untouched by it');
});

test('a revoked token no longer reads', async (t) => {
  withProject(t);
  const gone = sendertoken.mint('gone-reader');
  assert.ok(gone.ok);
  assert.ok(!refusedAtGate(await call('GET', '/api/tasks?project=p4491', asAgent(gone.token))), 'control: the fresh token reads');
  sendertoken.revoke('gone-reader');
  assert.ok(refusedAtGate(await call('GET', '/api/tasks?project=p4491', asAgent(gone.token))), 'a revoked token still reads the tasks');
});

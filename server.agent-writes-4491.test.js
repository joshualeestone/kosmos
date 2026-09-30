'use strict';

/**
 * #4491 slice 5: `kosmos task add` and `kosmos task close` answer to the agent's own token. The board names the
 * caller from it (task add also from its pane; task close reads no body, so from the token only) and an identified
 * agent adds and closes tasks only in a project it is on, the line task message and task built already draw, with
 * one exception: a project a process made that still lists nobody (what `kosmos project create` makes). A caller
 * nobody can name (the page, the person's terminal) is as before.
 *
 * Same harness as server.agent-token-gate-4491.test.js: the board boots fully sandboxed, then enforcement is
 * flipped on in memory, so no real store is touched. The task engine's writes are stubbed, so nothing is written.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agentwrites-4491-'));
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
const messagesEngine = require('./engine/messages');

const BOARD = 'BOARDTOKEN_test_4491_writes_0123456789abcdef';
const GATE_REFUSAL = /this board belongs to the account that started it/;
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
const refusedAtGate = (r) => r.code === 403 && GATE_REFUSAL.test(r.text);
const asAgent = (t) => ({ 'x-kosmos-agent-token': t });
const withBoard = (h = {}) => ({ 'x-kosmos-board-token': BOARD, ...h });

/* A fleet of two (mara is on p4491, otto is not), the project record, and the task engine's writes recorded, not made. */
function world(t, { members = ['mara'], unreadable = () => false, extra = [], origin = { via: 'screen', by: null } } = {}) {
  const board = fleet.install([...extra, fleet.agent('mara', { state: 'idle' }), fleet.agent('otto', { state: 'idle' })]);
  const real = { readAll: projectsEngine.readAll, create: tasksEngine.create, close: tasksEngine.close, reopen: tasksEngine.reopen };
  const made = [];
  const acts = [];
  projectsEngine.readAll = () => {
    if (unreadable()) { const e = new Error('unreadable'); e.code = 'UNREADABLE'; throw e; }
    return [{ id: 'p4491', name: 'p4491', agents: members, tasks: [], made: origin }];
  };
  tasksEngine.create = (id, fields) => { made.push({ id, by: fields.made.by, via: fields.made.via, sentence: fields.sentence }); return { number: made.length, sentence: fields.sentence, who: null }; };
  tasksEngine.close = (id, n) => { acts.push(['close', id, String(n)]); return { number: Number(n), state: 'closed' }; };
  tasksEngine.reopen = (id, n) => { acts.push(['reopen', id, String(n)]); return { number: Number(n), state: 'open' }; };
  t.after(() => { Object.assign(projectsEngine, { readAll: real.readAll }); Object.assign(tasksEngine, { create: real.create, close: real.close, reopen: real.reopen }); board.restore(); });
  return { made, acts, mara: sendertoken.mint('mara').token, otto: sendertoken.mint('otto').token, roster: board.roster, agents: board.agents };
}

test('CONTROL: task add and task close are refused at the gate with no credential and with a token nobody issued', async () => {
  for (const p of ['/api/project/p4491/tasks', '/api/project/p4491/task/1/close']) {
    assert.ok(refusedAtGate(await call('POST', p, { body: {} })), `the gate did not refuse a bare POST ${p}, so nothing below can be trusted`);
    assert.ok(refusedAtGate(await call('POST', p, { headers: asAgent('c'.repeat(64)), body: {} })), `POST ${p} passed the gate with a token nobody issued`);
  }
});

test('task add: a member adds with only its own token, and the task is recorded as added by it', async (t) => {
  const w = world(t);
  const r = await call('POST', '/api/project/p4491/tasks', { headers: asAgent(w.mara), body: { sentence: 'write the docs' } });
  assert.equal(r.code, 200, 'a member could not add a task on its token alone: ' + r.code + ' ' + r.text.slice(0, 160));
  assert.deepEqual(w.made, [{ id: 'p4491', by: 'mara', via: 'process', sentence: 'write the docs' }], 'the task was not recorded as the token\'s agent');
});

test('task add: an agent that is not on the project is refused, with or without the board token, and nothing is added', async (t) => {
  const w = world(t);
  const alone = await call('POST', '/api/project/p4491/tasks', { headers: asAgent(w.otto), body: { sentence: 'not mine to add' } });
  assert.equal(alone.code, 403, 'a non-member added a task: ' + alone.code + ' ' + alone.text.slice(0, 160));
  assert.match(JSON.parse(alone.text).error, /not on this project, so it cannot add tasks to it/);
  const both = await call('POST', '/api/project/p4491/tasks', { headers: withBoard(asAgent(w.otto)), body: { sentence: 'not mine to add' } });
  assert.equal(both.code, 403, 'the board token let an identified non-member add a task (task message and task built refuse it too)');
  assert.deepEqual(w.made, [], 'a refused add still reached the task engine');
});

test('task add: the body cannot name another agent; the header token is the caller', async (t) => {
  const w = world(t);
  const mara = w.roster.find((c) => c.sessionName === 'mara');
  const spoof = await call('POST', '/api/project/p4491/tasks', { headers: asAgent(w.otto), body: { sentence: 'as mara', token: w.mara, from_pane: mara.session } });
  assert.equal(spoof.code, 403, 'a body naming a member let a non-member add: ' + spoof.code);
  assert.deepEqual(w.made, []);
});

test('task add: a pane that resolves to an agent names it; a caller nobody can name is as before', async (t) => {
  const w = world(t);
  /* The tokenless Mac CLI sends $TMUX_PANE (%N), which the handler resolves through messages.resolveSender. Stubbed
     here, as in the slice-3 tests: tmux is not running in the suite. */
  const realResolve = messagesEngine.resolveSender;
  const asked = [];
  messagesEngine.resolveSender = (pane, roster) => {
    asked.push(pane);
    const name = pane === '%7' ? 'otto' : pane === '%8' ? 'mara' : null;
    const card = name && roster.find((c) => c.sessionName === name);
    return card ? { ok: true, card } : { ok: false, because: 'no such pane' };
  };
  t.after(() => { messagesEngine.resolveSender = realResolve; });
  const add = (headers, body) => call('POST', '/api/project/p4491/tasks', { headers, body });
  const byPane = await add(withBoard(), { sentence: 'by pane', from_pane: '%8' });
  assert.equal(byPane.code, 200, byPane.text.slice(0, 160));
  assert.equal(w.made[0].by, 'mara', 'a pane that resolves to an agent did not name it');
  const outsiderPane = await add(withBoard(), { sentence: 'by pane', from_pane: '%7' });
  assert.equal(outsiderPane.code, 403, 'a non-member named by its pane added a task: ' + outsiderPane.code);
  /* A pane that resolves to nobody, no pane at all (the person's terminal), and the page: not refused, no name. */
  const stranger = await add(withBoard(), { sentence: 'a pane nobody holds', from_pane: '%99' });
  assert.equal(stranger.code, 200, stranger.text.slice(0, 160));
  const terminal = await add(withBoard(), { sentence: 'from a terminal', from_pane: '' });
  assert.equal(terminal.code, 200, terminal.text.slice(0, 160));
  const page = await add(withBoard({ 'sec-fetch-site': 'same-origin', origin: base }), { sentence: 'from the page', from_pane: '%7' });
  assert.equal(page.code, 200, 'the page was held to a pane it sent: ' + page.code + ' ' + page.text.slice(0, 160));
  assert.deepEqual(w.made.slice(1).map((m) => [m.by, m.via]), [[null, 'process'], [null, 'process'], [null, 'screen']]);
  assert.deepEqual(asked, ['%8', '%7', '%99'], 'the pane was not asked of resolveSender exactly when a process offered one');
});

test('a token the board cannot resolve is refused, never swapped for a pane that would have named a member', async (t) => {
  const w = world(t);
  const realResolve = messagesEngine.resolveSender;
  messagesEngine.resolveSender = (pane, roster) => ({ ok: true, card: roster.find((c) => c.sessionName === 'mara') });
  t.after(() => { messagesEngine.resolveSender = realResolve; });
  /* The board token gets it past the gate, so the handler is what judges the bad agent token. */
  const bad = withBoard(asAgent('d'.repeat(64)));
  const add = await call('POST', '/api/project/p4491/tasks', { headers: bad, body: { sentence: 'as mara', from_pane: '%8' } });
  assert.equal(add.code, 403, 'a bad token fell back to the pane on task add: ' + add.code + ' ' + add.text.slice(0, 120));
  assert.doesNotMatch(add.text, GATE_REFUSAL, 'the 403 is the gate\'s, so the handler was never asked');
  const close = await call('POST', '/api/project/p4491/task/1/close', { headers: bad });
  assert.equal(close.code, 403, 'a bad token was ignored on task close: ' + close.code + ' ' + close.text.slice(0, 120));
  assert.doesNotMatch(close.text, GATE_REFUSAL);
  assert.deepEqual([w.made, w.acts], [[], []]);
  /* CONTROL: the same pane with no token at all IS named, so the 403 above is the bad token. */
  assert.equal((await call('POST', '/api/project/p4491/tasks', { headers: withBoard(), body: { sentence: 'by pane', from_pane: '%8' } })).code, 200);
  assert.equal(w.made[0].by, 'mara');
});

test('task add: when the projects cannot be read, an identified agent is refused (503) and nothing is added', async (t) => {
  let blind = false;
  const w = world(t, { unreadable: () => blind });
  assert.equal((await call('POST', '/api/project/p4491/tasks', { headers: asAgent(w.mara), body: { sentence: 'ok' } })).code, 200, 'control: a member adds while the list is readable');
  blind = true;
  const r = await call('POST', '/api/project/p4491/tasks', { headers: asAgent(w.mara), body: { sentence: 'blind' } });
  assert.equal(r.code, 503, 'an unreadable projects list let an identified agent through: ' + r.code + ' ' + r.text.slice(0, 120));
  assert.equal(w.made.length, 1, 'the blind add reached the task engine');
});

test('when the running agents cannot be read: a token is refused (503), a pane or nobody is as before', async (t) => {
  const w = world(t);
  const blind = fleet.blind();   // tmux could not be asked: the roster is unreadable, not empty
  t.after(() => blind.restore());
  const add = await call('POST', '/api/project/p4491/tasks', { headers: asAgent(w.mara), body: { sentence: 'unchecked' } });
  assert.equal(add.code, 503, 'a token nobody could check added a task: ' + add.code + ' ' + add.text.slice(0, 120));
  assert.match(JSON.parse(add.text).error, /could not check which agents are running, so the task was not added/);
  const close = await call('POST', '/api/project/p4491/task/1/close', { headers: asAgent(w.mara) });
  assert.equal(close.code, 503, 'a token nobody could check closed a task: ' + close.code);
  assert.match(JSON.parse(close.text).error, /so the task was not closed/);
  assert.deepEqual([w.made, w.acts], [[], []]);
  /* No token: exactly as before this slice. A pane names nobody, the task is added unnamed; a close reads no roster. */
  const pane = await call('POST', '/api/project/p4491/tasks', { headers: withBoard(), body: { sentence: 'from a tmux window', from_pane: '%3' } });
  assert.equal(pane.code, 200, 'the person\'s terminal lost task add to an unreadable roster: ' + pane.code + ' ' + pane.text.slice(0, 120));
  assert.equal((await call('POST', '/api/project/p4491/task/2/close', { headers: withBoard() })).code, 200);
  assert.deepEqual([w.made.map((m) => m.by), w.acts], [[null], [['close', 'p4491', '2']]]);
});

test('a live agent with no roster row (a Windows agent) is matched to the project by the token store\'s key', async (t) => {
  const liveness = require('./engine/liveness');
  const realAlive = liveness.alive;
  liveness.alive = (key) => (key === 'ghost' ? true : realAlive(key));
  t.after(() => { liveness.alive = realAlive; });
  const w = world(t, { members: ['Ghost'] });   // stored as written; the token store keys it "ghost"
  const ghost = sendertoken.mint('ghost').token;
  const add = await call('POST', '/api/project/p4491/tasks', { headers: asAgent(ghost), body: { sentence: 'from Windows' } });
  assert.equal(add.code, 200, 'a paneless member could not add: ' + add.code + ' ' + add.text.slice(0, 160));
  assert.equal((await call('POST', '/api/project/p4491/task/1/close', { headers: asAgent(ghost) })).code, 200, 'a paneless member could not close');
  assert.deepEqual([w.made.map((m) => m.by), w.acts], [['ghost'], [['close', 'p4491', '1']]]);
  /* CONTROL: mara has a roster row, so she is matched by exact name, and "Ghost" is not her. */
  assert.equal((await call('POST', '/api/project/p4491/tasks', { headers: asAgent(w.mara), body: { sentence: 'not on it' } })).code, 403);
});

test('a roster pane that is not tied to our agent names nobody: no name recorded, and not held to membership', async (t) => {
  /* A stranger's session sitting under the name "zed" (not ours). Its pane target is a real roster target. */
  const w = world(t, { extra: [fleet.stranger('zed', { state: 'idle' })] });
  const zed = w.agents.find((a) => a.sessionName === 'zed');
  const mara = w.agents.find((a) => a.sessionName === 'mara');
  assert.ok(zed && zed.target && zed.isNamedOurs !== true, 'the fixture no longer gives an untied roster row with a target; restate this setup');
  assert.ok(mara && mara.target && mara.isNamedOurs === true, 'control: the tied row is not tied');
  const realResolve = messagesEngine.resolveSender;
  messagesEngine.resolveSender = () => ({ ok: false, because: 'not one of ours' });   // what it answers for a stranger's pane
  t.after(() => { messagesEngine.resolveSender = realResolve; });
  const untied = await call('POST', '/api/project/p4491/tasks', { headers: withBoard(), body: { sentence: 'from a stranger\'s pane', from_pane: zed.target } });
  assert.equal(untied.code, 200, 'an untied pane was held to membership as "zed": ' + untied.code + ' ' + untied.text.slice(0, 120));
  assert.equal(w.made[0].by, null, 'a stranger\'s pane was recorded as our agent');
  /* CONTROL: the tied row's target still names its agent without asking tmux. */
  const tied = await call('POST', '/api/project/p4491/tasks', { headers: withBoard(), body: { sentence: 'from mara\'s pane', from_pane: mara.target } });
  assert.equal(tied.code, 200, tied.text.slice(0, 120));
  assert.equal(w.made[1].by, 'mara');
});

test('a token the resolver cannot check (it throws) is a 503 on both writes, and the board keeps answering', async (t) => {
  /* #4738: a tmux session whose name has no letter or digit AND sorts ahead of the agent's row ("!!" does; a name
     in Japanese sorts after and does not) makes sendertoken.resolve throw. The close handler names its caller
     outside any try, so a throw there leaves the request unanswered (measured: with the catch removed this test
     hangs until the runner gives up) and may end the board's process; it must be answered instead. */
  const w = world(t, { extra: [fleet.stranger('!!', { state: 'idle' })] });
  assert.throws(() => sendertoken.resolve(w.mara, w.agents), /invalid agent name/, 'control: the resolver no longer throws on this roster (if #4738 is fixed, make it throw another way, or drop this test\'s premise)');
  const close = await call('POST', '/api/project/p4491/task/1/close', { headers: asAgent(w.mara) });
  assert.equal(close.code, 503, 'a throwing resolver was not answered with a 503 on close: ' + close.code + ' ' + close.text.slice(0, 120));
  assert.match(JSON.parse(close.text).error, /^we could not check that agent just now, so the task was not closed$/, 'the roster WAS read here, so the sentence must not say it was not');
  const add = await call('POST', '/api/project/p4491/tasks', { headers: asAgent(w.mara), body: { sentence: 'unchecked' } });
  assert.equal(add.code, 503, 'a throwing resolver was not a 503 on add: ' + add.code + ' ' + add.text.slice(0, 120));
  assert.deepEqual([w.made, w.acts], [[], []]);
  /* The board is still there, and a caller with no token is untouched. */
  assert.equal((await call('POST', '/api/project/p4491/task/2/close', { headers: withBoard() })).code, 200, 'the board stopped answering after the throw');
});

test('task close: when the projects cannot be read, a token is refused (503) and nothing is closed', async (t) => {
  let blind = false;
  const w = world(t, { unreadable: () => blind });
  assert.equal((await call('POST', '/api/project/p4491/task/1/close', { headers: asAgent(w.mara) })).code, 200, 'control: a member closes while the list is readable');
  blind = true;
  assert.equal((await call('POST', '/api/project/p4491/task/2/close', { headers: asAgent(w.mara) })).code, 503);
  assert.deepEqual(w.acts, [['close', 'p4491', '1']]);
});

test('a project a process made that still lists nobody (what `kosmos project create` makes) takes tasks from an identified agent, as before', async (t) => {
  /* The agent instructions say: make a project, then hand it work. The CLI makes it with nobody on it. */
  const w = world(t, { members: [], origin: { via: 'process', by: null } });
  const add = await call('POST', '/api/project/p4491/tasks', { headers: asAgent(w.otto), body: { sentence: 'first task on my new project' } });
  assert.equal(add.code, 200, 'the maker of a memberless project could not hand it work: ' + add.code + ' ' + add.text.slice(0, 160));
  /* Any task there, not only its own: a stated consequence (the plan's "Who gains"). */
  assert.equal((await call('POST', '/api/project/p4491/task/7/close', { headers: asAgent(w.otto) })).code, 200);
  assert.deepEqual([w.made.map((m) => m.by), w.acts], [['otto'], [['close', 'p4491', '7']]]);
});

test('a project with no members that the PERSON made or emptied, or whose member list is not a list, is not opened', async (t) => {
  let agents = [];
  let made = { via: 'screen', by: null };
  const w = world(t);
  const realAll = projectsEngine.readAll;
  projectsEngine.readAll = () => [{ id: 'p4491', name: 'p4491', agents, tasks: [], made }];
  try {
    const tryBoth = async (why) => {
      assert.equal((await call('POST', '/api/project/p4491/tasks', { headers: asAgent(w.otto), body: { sentence: 'x' } })).code, 403, 'task add opened: ' + why);
      assert.equal((await call('POST', '/api/project/p4491/task/1/close', { headers: asAgent(w.otto) })).code, 403, 'task close opened: ' + why);
    };
    await tryBoth('a project the person made with nobody ticked, or emptied by removing its last member');
    made = null;
    await tryBoth('an old record with no `made`');
    made = { via: 'kosmos', by: null };
    await tryBoth('a project Kosmos made itself');
    made = { via: 'process', by: null };
    for (const shape of [undefined, null, 'mara', { 0: 'mara' }]) { agents = shape; await tryBoth('a process-made project whose agents is ' + JSON.stringify(shape)); }
    agents = ['mara'];
    await tryBoth('a process-made project that has a member now');
    assert.deepEqual([w.made, w.acts], [[], []]);
    /* CONTROL: the same process-made project with an empty list IS open, so the 403s above are each their own reason. */
    agents = [];
    assert.equal((await call('POST', '/api/project/p4491/tasks', { headers: asAgent(w.otto), body: { sentence: 'x' } })).code, 200);
  } finally { projectsEngine.readAll = realAll; }
});

test('a project id stored twice, one copy empty and process-made, the other with members the agent is not on: refused', async (t) => {
  const w = world(t);
  const realAll = projectsEngine.readAll;
  projectsEngine.readAll = () => [
    { id: 'p4491', name: 'one', agents: [], tasks: [], made: { via: 'process', by: null } },
    { id: 'p4491', name: 'two', agents: ['mara'], tasks: [], made: { via: 'screen', by: null } },
  ];
  try {
    assert.equal((await call('POST', '/api/project/p4491/tasks', { headers: asAgent(w.otto), body: { sentence: 'x' } })).code, 403);
    assert.equal((await call('POST', '/api/project/p4491/tasks', { headers: asAgent(w.mara), body: { sentence: 'x' } })).code, 200, 'control: a member of the staffed copy adds');
  } finally { projectsEngine.readAll = realAll; }
});

test('task close: a member closes with only its own token; a non-member is refused and nothing is closed', async (t) => {
  const w = world(t);
  const member = await call('POST', '/api/project/p4491/task/3/close', { headers: asAgent(w.mara) });
  assert.equal(member.code, 200, 'a member could not close on its token alone: ' + member.code + ' ' + member.text.slice(0, 160));
  const outsider = await call('POST', '/api/project/p4491/task/4/close', { headers: asAgent(w.otto) });
  assert.equal(outsider.code, 403, 'a non-member closed a task: ' + outsider.code + ' ' + outsider.text.slice(0, 160));
  assert.match(JSON.parse(outsider.text).error, /not on this project, so it cannot close its tasks/);
  const outsiderBoth = await call('POST', '/api/project/p4491/task/4/close', { headers: withBoard(asAgent(w.otto)) });
  assert.equal(outsiderBoth.code, 403, 'the board token let an identified non-member close a task');
  assert.deepEqual(w.acts, [['close', 'p4491', '3']], 'a refused close still reached the task engine');
});

test('task close: a caller with no agent token is as before (the page, the person\'s terminal)', async (t) => {
  const w = world(t);
  const terminal = await call('POST', '/api/project/p4491/task/5/close', { headers: withBoard() });
  assert.equal(terminal.code, 200, terminal.text.slice(0, 160));
  const page = await call('POST', '/api/project/p4491/task/6/close', { headers: withBoard({ 'sec-fetch-site': 'same-origin', origin: base }) });
  assert.equal(page.code, 200, page.text.slice(0, 160));
  assert.deepEqual(w.acts, [['close', 'p4491', '5'], ['close', 'p4491', '6']]);
});

test('reopen stays behind the board token; with it, an identified agent still has to be on the project', async (t) => {
  const w = world(t);
  assert.ok(refusedAtGate(await call('POST', '/api/project/p4491/task/3/reopen', { headers: asAgent(w.mara) })), 'reopen opened to an agent token alone');
  assert.equal((await call('POST', '/api/project/p4491/task/3/reopen', { headers: withBoard(asAgent(w.mara)) })).code, 200, 'a member with the board token could not reopen');
  const outsider = await call('POST', '/api/project/p4491/task/3/reopen', { headers: withBoard(asAgent(w.otto)) });
  assert.equal(outsider.code, 403, 'an identified non-member reopened a task: ' + outsider.code);
  assert.match(JSON.parse(outsider.text).error, /cannot reopen its tasks/);
  assert.deepEqual(w.acts, [['reopen', 'p4491', '3']]);
});

test('only these two writes opened: every neighbour stays behind the board token', async (t) => {
  const w = world(t);
  const closed = [
    ['POST', '/api/project/p4491/task/1/reopen'], ['POST', '/api/project/p4491/task/1/due'], ['POST', '/api/project/p4491/task/1/close/'],
    ['POST', '/api/project/p4491/task/x/close'], ['POST', '/api/project/a/b/tasks'], ['POST', '/api/project/p4491/tasks/'],
    ['PUT', '/api/project/p4491/tasks'], ['DELETE', '/api/project/p4491/tasks'], ['GET', '/api/project/p4491/tasks'],
    ['POST', '/api/tasks/close'], ['POST', '/api/projects'], ['POST', '/api/project/p4491/room/reopen'], ['GET', '/api/project/p4491/task/1/activity'],
  ];
  for (const [method, p] of closed) {
    const r = await call(method, p, { headers: asAgent(w.mara), body: method === 'GET' ? undefined : {} });
    assert.ok(refusedAtGate(r), `${method} ${p} was reachable with only an agent token: ${r.code} ${r.text.slice(0, 80)}`);
  }
});

test('a revoked token neither adds nor closes', async (t) => {
  const w = world(t);
  sendertoken.revoke('mara');
  assert.ok(refusedAtGate(await call('POST', '/api/project/p4491/tasks', { headers: asAgent(w.mara), body: { sentence: 'late' } })));
  assert.ok(refusedAtGate(await call('POST', '/api/project/p4491/task/1/close', { headers: asAgent(w.mara) })));
  assert.deepEqual([w.made, w.acts], [[], []]);
});

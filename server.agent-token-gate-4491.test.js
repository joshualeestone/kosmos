'use strict';

/**
 * #4491 (proof of concept): on an enforcing board, an agent reaches its everyday routes with ONLY
 * its own agent token, and that token never opens a person-only route.
 *
 * Same harness as server.board-auth-1946.test.js: the board boots fully sandboxed, then
 * enforcement is flipped on in memory, so no real store is touched.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agenttoken-4491-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
/* The test reaches POST /api/agents (to prove an agent token cannot), so Claude Code's config is
   sandboxed too, as every agent-creating suite must (fixture-discipline.test.js). */
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

const { start, server, boardAuthState } = require('./server');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');
const messagesEngine = require('./engine/messages');
const chatEngine = require('./engine/chat');
const projectsEngine = require('./engine/projects');
const feedpublish = require('./engine/feedpublish');
const tasksEngine = require('./engine/tasks');

const BOARD = 'BOARDTOKEN_test_4491_0123456789abcdef';
const GATE_REFUSAL = /this board belongs to the account that started it/;
let base;
let agentToken;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  const minted = sendertoken.mint('poc-agent');
  assert.ok(minted.ok, 'could not mint an agent token for the test: ' + minted.because);
  agentToken = minted.token;
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

test('CONTROL: an agent route with no credential is refused at the gate', async () => {
  for (const p of ['/api/whoami', '/api/react', '/api/community/post']) {
    assert.ok(refusedAtGate(await call('POST', p, { body: {} })), `the gate did not refuse a bare POST ${p}, so nothing below can be trusted`);
  }
});

test('an agent route passes the gate with only a valid agent token (no board token)', async () => {
  for (const [method, p, body] of [['POST', '/api/whoami', {}], ['POST', '/api/msg', { to: 'nobody', text: 'hi' }], ['POST', '/api/post', { project: 'none', text: 'hi' }], ['POST', '/api/react', { project: 'none', of: 'm1', emoji: 'x' }]]) {
    const r = await call(method, p, { headers: { 'x-kosmos-agent-token': agentToken }, body });
    assert.ok(!refusedAtGate(r), `${method} ${p} was refused at the gate with a valid agent token: ${r.code} ${r.text.slice(0, 120)}`);
  }
});

test('a wrong agent token is refused at the gate', async () => {
  assert.ok(refusedAtGate(await call('POST', '/api/whoami', { headers: { 'x-kosmos-agent-token': 'not-a-token' }, body: {} })));
});

test('an agent token in the BODY does not open the gate (header only, the gate runs before the body)', async () => {
  assert.ok(refusedAtGate(await call('POST', '/api/whoami', { body: { token: agentToken } })));
});

test('an agent token never opens a person-only route', async () => {
  for (const [method, p] of [['POST', '/api/agent/poc-agent/removal'], ['DELETE', '/api/agent/poc-agent/removal'], ['POST', '/api/agents'], ['GET', '/api/status']]) {
    const r = await call(method, p, { headers: { 'x-kosmos-agent-token': agentToken }, body: method === 'GET' ? undefined : {} });
    assert.ok(refusedAtGate(r), `${method} ${p} was reachable with only an agent token: ${r.code}`);
  }
});

test('the caller is identified as the token\'s agent, even when the body names another', async (t) => {
  const board = fleet.install([fleet.agent('poc-agent', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  t.after(() => board.restore());
  const mara = board.roster.find((c) => c.sessionName === 'mara');
  const maraToken = sendertoken.mint('mara').token;
  const alone = await call('POST', '/api/whoami', { headers: { 'x-kosmos-agent-token': agentToken }, body: {} });
  assert.equal(alone.code, 200);
  assert.equal(JSON.parse(alone.text).agent, 'poc-agent', 'the header token did not identify its own agent: ' + alone.text.slice(0, 160));
  const spoof = await call('POST', '/api/whoami', {
    headers: { 'x-kosmos-agent-token': agentToken },
    body: { token: maraToken, from_pane: mara.session },
  });
  assert.equal(JSON.parse(spoof.text).agent, 'poc-agent', 'a body naming another agent changed who the caller is: ' + spoof.text.slice(0, 160));
  /* CONTROL: the body token IS read when there is no header token (with the board token to pass
     the gate), so the assertion above is the header winning, not the body being ignored. */
  const bodyOnly = await call('POST', '/api/whoami', { headers: { 'x-kosmos-board-token': BOARD }, body: { token: maraToken } });
  assert.equal(JSON.parse(bodyOnly.text).agent, 'mara', 'control: a body token alone did not identify its agent: ' + bodyOnly.text.slice(0, 160));
});

test('a token-only msg is SENT as the token\'s agent, even when the body names another', async (t) => {
  const board = fleet.install([fleet.agent('poc-agent', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  const sends = [];
  chatEngine.setRunner((args) => {
    sends.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chatEngine.setDryRun(false);
  t.after(() => { messagesEngine.resetForTests(); chatEngine.setRunner(null); chatEngine.setDryRun(true); board.restore(); });
  const mara = board.roster.find((c) => c.sessionName === 'mara');
  const maraToken = sendertoken.mint('mara').token;
  const r = await call('POST', '/api/msg', {
    headers: { 'x-kosmos-agent-token': agentToken },
    body: { to: 'mara', text: 'from the token agent', from_pane: mara.session, token: maraToken },
  });
  assert.equal(r.code, 200, r.text.slice(0, 160));
  assert.equal(JSON.parse(r.text).delivery.state, 'placed', 'the token-only msg was not delivered: ' + r.text.slice(0, 200));
  const pasted = sends.filter((a) => a[0] === 'set-buffer').map((a) => a[a.length - 1]).join('');
  assert.match(pasted, /colleague poc-agent/, 'the msg was not sent as the header token\'s agent');
  assert.doesNotMatch(pasted, /colleague mara/, 'the body\'s pane or token changed the sender');
});

test('a token-only react is recorded as the token\'s agent, even when the body names another (#4491 slice 2)', async (t) => {
  const board = fleet.install([fleet.agent('poc-agent', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  const realGet = projectsEngine.get;
  const realReact = messagesEngine.react;
  const reacts = [];
  projectsEngine.get = (id) => (id === 'p4491' ? { id: 'p4491', agents: board.roster } : null);
  messagesEngine.react = (args) => { reacts.push(args); return { ok: true }; };
  t.after(() => { projectsEngine.get = realGet; messagesEngine.react = realReact; board.restore(); });
  const mara = board.roster.find((c) => c.sessionName === 'mara');
  const maraToken = sendertoken.mint('mara').token;
  // Another agent named by the body twice over (its pane AND its token): the header token still decides.
  const r = await call('POST', '/api/react', {
    headers: { 'x-kosmos-agent-token': agentToken },
    body: { project: 'p4491', of: 'm1', emoji: 'thumbsup', from_pane: mara.session, token: maraToken },
  });
  assert.equal(r.code, 200, r.text.slice(0, 160));
  assert.equal(reacts.length, 1, 'the react never reached the engine: ' + r.text.slice(0, 160));
  assert.equal(reacts[0].from, 'poc-agent', 'the react was not recorded as the header token\'s agent');
  /* CONTROL: another agent's token (in the body, with the board token to pass the gate) is
     recorded as THAT agent, so the assertion above follows the presented token, not a constant. */
  const other = await call('POST', '/api/react', {
    headers: { 'x-kosmos-board-token': BOARD },
    body: { project: 'p4491', of: 'm1', emoji: 'thumbsup', token: maraToken },
  });
  assert.equal(other.code, 200, other.text.slice(0, 160));
  assert.equal(reacts[1] && reacts[1].from, 'mara', 'control: another agent\'s token did not identify it: ' + other.text.slice(0, 160));
});

test('a token-only community post is still refused at the gate: the public feed needs the board token (#4491 slice 2)', async () => {
  /* Deliberate: /api/community/post writes to the PUBLIC feed. With an agent token alone, an agent that
     cannot read board.token (the sandboxed setup guide) could publish. It stays board token + agent token. */
  assert.ok(refusedAtGate(await call('POST', '/api/community/post', {
    headers: { 'x-kosmos-agent-token': agentToken },
    body: { title: 'hello', body: 'from the token agent' },
  })), 'an agent token alone reached the public community feed');
  /* CONTROL: with the board token as well, the same request gets past the gate, so the refusal above is
     the gate's and not a broken request. */
  const realPublish = feedpublish.publishPost;
  feedpublish.publishPost = () => ({ ok: false, because: 'stubbed in the test' });
  try {
    const r = await call('POST', '/api/community/post', {
      headers: { 'x-kosmos-agent-token': agentToken, 'x-kosmos-board-token': BOARD },
      body: { title: 'hello', body: 'from the token agent' },
    });
    assert.ok(!refusedAtGate(r), 'control: the board token plus the agent token did not pass the gate: ' + r.code);
  } finally { feedpublish.publishPost = realPublish; }
});

test('task message and task built pass the gate with only an agent token; close and reopen do not (#4491 slice 3)', async () => {
  for (const verb of ['message', 'built']) {
    const p = '/api/project/p4491/task/1/' + verb;
    assert.ok(refusedAtGate(await call('POST', p, { body: {} })), `control: POST ${p} with no credential was not refused`);
    const r = await call('POST', p, { headers: { 'x-kosmos-agent-token': agentToken }, body: { text: 'hi' } });
    assert.ok(!refusedAtGate(r), `POST ${p} was refused at the gate with a valid agent token: ${r.code} ${r.text.slice(0, 120)}`);
  }
  for (const p of ['/api/project/p4491/task/1/close', '/api/project/p4491/task/1/reopen', '/api/project/p4491/task/1/message/x', '/api/project/a/b/task/1/built', '/api/project/p4491/task/1/message/', '/api/project/p4491/task/x/message']) {
    assert.ok(refusedAtGate(await call('POST', p, { headers: { 'x-kosmos-agent-token': agentToken }, body: {} })), `POST ${p} was reachable with only an agent token`);
  }
});

test('an encoded slash passes the gate and then names no project: 404 (#4491 slice 3)', async (t) => {
  /* The pattern is judged before the handler decodes the project, so `a%2Fb` passes the gate as one segment; the
     handler decodes it to `a/b`, which no stored project has. A member token, so the 404 is the project lookup. */
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  const realAll = projectsEngine.readAll;
  projectsEngine.readAll = () => [{ id: 'a', name: 'a', agents: ['mara'] }, { id: 'b', name: 'b', agents: ['mara'] }];
  t.after(() => { projectsEngine.readAll = realAll; board.restore(); });
  const enc = await call('POST', '/api/project/a%2Fb/task/1/message', { headers: { 'x-kosmos-agent-token': sendertoken.mint('mara').token }, body: { text: 'hi' } });
  assert.ok(!refusedAtGate(enc), 'control: an encoded slash was refused at the gate');
  assert.equal(enc.code, 404, 'an encoded slash was not a 404: ' + enc.code + ' ' + enc.text.slice(0, 120));
});

test('task message refuses an agent that is not on the project, before recording anything (#4491 slice 3)', async (t) => {
  const board = fleet.install([fleet.agent('poc-agent', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  const realAll = projectsEngine.readAll;
  const realSay = tasksEngine.say;
  const realWho = tasksEngine.whoOf;
  const said = [];
  projectsEngine.readAll = () => [{ id: 'p4491', name: 'p4491', agents: ['mara'] }];
  tasksEngine.say = (id, num, text) => { said.push({ id, num, text }); return { number: Number(num) }; };
  tasksEngine.whoOf = () => [];
  t.after(() => { projectsEngine.readAll = realAll; tasksEngine.say = realSay; tasksEngine.whoOf = realWho; board.restore(); });
  const outsider = await call('POST', '/api/project/p4491/task/1/message', { headers: { 'x-kosmos-agent-token': agentToken }, body: { text: 'not my project' } });
  assert.equal(outsider.code, 403, 'a non-member was not refused: ' + outsider.code + ' ' + outsider.text.slice(0, 160));
  assert.match(outsider.text, /not on this project/);
  assert.equal(said.length, 0, 'the non-member\'s message was recorded anyway');
  /* CONTROL: the same request from an agent that IS on the project is recorded, so the refusal above is
     membership and not a broken request or a stub that records nothing. */
  const member = await call('POST', '/api/project/p4491/task/1/message', { headers: { 'x-kosmos-agent-token': sendertoken.mint('mara').token }, body: { text: 'my project' } });
  assert.equal(member.code, 200, 'control: a member was not recorded: ' + member.code + ' ' + member.text.slice(0, 160));
  assert.equal(said.length, 1);
  assert.equal(said[0].text, 'my project');
  /* The pane arm (no token, board token to pass the gate): a non-member's pane is refused, a member's recorded. */
  const targetOf = (name) => (board.agents.find((c) => c.sessionName === name) || {}).target;
  const pocTarget = targetOf('poc-agent');
  assert.ok(pocTarget && targetOf('mara'), 'the fixture gave no pane targets');
  const paneOut = await call('POST', '/api/project/p4491/task/1/message', { headers: { 'x-kosmos-board-token': BOARD }, body: { text: 'by pane', from_pane: pocTarget } });
  assert.equal(paneOut.code, 403, 'a non-member pane was not refused: ' + paneOut.code + ' ' + paneOut.text.slice(0, 160));
  const paneIn = await call('POST', '/api/project/p4491/task/1/message', { headers: { 'x-kosmos-board-token': BOARD }, body: { text: 'by member pane', from_pane: targetOf('mara') } });
  assert.equal(paneIn.code, 200, 'control: a member pane was not recorded: ' + paneIn.code + ' ' + paneIn.text.slice(0, 160));
  assert.equal(said.length, 2);
});

test('task message resolves a tmux %N pane through resolveSender, and refuses a non-member by it (#4491 slice 3)', async (t) => {
  /* The tokenless Mac CLI sends $TMUX_PANE (%N), which no roster target equals, so the handler asks
     messages.resolveSender. Stubbed here: tmux is not running in the suite. */
  const board = fleet.install([fleet.agent('poc-agent', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  const realAll = projectsEngine.readAll;
  const realSay = tasksEngine.say;
  const realWho = tasksEngine.whoOf;
  const realResolve = messagesEngine.resolveSender;
  const said = [];
  const asked = [];
  projectsEngine.readAll = () => [{ id: 'p4491', name: 'p4491', agents: ['mara'] }];
  tasksEngine.say = (id, num, text) => { said.push(text); return { number: Number(num) }; };
  tasksEngine.whoOf = () => [];
  messagesEngine.resolveSender = (pane, roster) => {
    asked.push(pane);
    const name = pane === '%7' ? 'poc-agent' : pane === '%8' ? 'mara' : null;
    const card = name && roster.find((c) => c.sessionName === name);
    return card ? { ok: true, card } : { ok: false, because: 'no such pane' };
  };
  t.after(() => { projectsEngine.readAll = realAll; tasksEngine.say = realSay; tasksEngine.whoOf = realWho; messagesEngine.resolveSender = realResolve; board.restore(); });
  const send = (pane, text) => call('POST', '/api/project/p4491/task/1/message', { headers: { 'x-kosmos-board-token': BOARD }, body: { text, from_pane: pane } });
  assert.equal((await send('%7', 'outsider')).code, 403, 'a non-member %N pane was not refused');
  const inside = await send('%8', 'member');
  assert.equal(inside.code, 200, 'control: a member %N pane was not recorded: ' + inside.code + ' ' + inside.text.slice(0, 160));
  assert.deepEqual(asked, ['%7', '%8'], 'the %N pane never reached resolveSender');
  assert.deepEqual(said, ['member']);
});

test('task message: a pane held by a stranger is not taken for our agent; an unreadable project list is a 503 (#4491 slice 3)', async (t) => {
  const board = fleet.install([fleet.agent('mara', { state: 'idle' }), fleet.stranger('poc-agent', { state: 'idle' })]);
  const realAll = projectsEngine.readAll;
  const realSay = tasksEngine.say;
  const realWho = tasksEngine.whoOf;
  const said = [];
  let unreadable = false;
  const realResolve = messagesEngine.resolveSender;
  messagesEngine.resolveSender = () => ({ ok: false, because: 'stubbed: no tmux in the suite' });   // never read this machine's tmux
  projectsEngine.readAll = () => { if (unreadable) { const e = new Error('unreadable'); e.code = 'UNREADABLE'; throw e; } return [{ id: 'p4491', name: 'p4491', agents: ['mara'] }]; };
  /* projects.get reads through the module's own readAll, not the export stubbed above, so it is stubbed too: a
     read after the record must be able to fail here, or the 200 below would prove nothing. */
  const realGet = projectsEngine.get;
  projectsEngine.get = (id) => { if (unreadable) { const e = new Error('unreadable'); e.code = 'UNREADABLE'; throw e; } return realGet(id); };
  tasksEngine.say = (id, num, text) => { said.push(text); return { number: Number(num) }; };
  tasksEngine.whoOf = () => [];
  t.after(() => { projectsEngine.readAll = realAll; projectsEngine.get = realGet; tasksEngine.say = realSay; tasksEngine.whoOf = realWho; messagesEngine.resolveSender = realResolve; board.restore(); });
  const targetOf = (name) => (board.agents.find((c) => c.sessionName === name) || {}).target;
  const strangerTarget = targetOf('poc-agent');
  assert.ok(strangerTarget, 'the fixture gave the stranger no pane target');
  // Not tied to our agent, so not identified as poc-agent: not refused as a non-member (it stays an unnamed process).
  const r = await call('POST', '/api/project/p4491/task/1/message', { headers: { 'x-kosmos-board-token': BOARD }, body: { text: 'from a stranger pane', from_pane: strangerTarget } });
  assert.equal(r.code, 200, 'a stranger pane was identified as our agent and refused: ' + r.code + ' ' + r.text.slice(0, 160));
  assert.deepEqual(said, ['from a stranger pane']);
  // An identified caller whose project list cannot be read is told so (503), and nothing is recorded.
  unreadable = true;
  const u = await call('POST', '/api/project/p4491/task/1/message', { headers: { 'x-kosmos-agent-token': sendertoken.mint('mara').token }, body: { text: 'while unreadable' } });
  assert.equal(u.code, 503, 'an unreadable project list was not a 503: ' + u.code + ' ' + u.text.slice(0, 160));
  assert.deepEqual(said, ['from a stranger pane']);
  /* An UNIDENTIFIED caller is not held to membership, so it is recorded; the project list is read once, before the
     record, so a failed read cannot turn a recorded message into a 400 afterwards. */
  const anon = await call('POST', '/api/project/p4491/task/1/message', { headers: { 'x-kosmos-board-token': BOARD }, body: { text: 'unnamed while unreadable' } });
  assert.equal(anon.code, 200, 'a recorded message answered ' + anon.code + ': ' + anon.text.slice(0, 160));
  assert.deepEqual(said, ['from a stranger pane', 'unnamed while unreadable']);
});

test('task message does not tell an assignee that has left the project, and says so (#4491 slice 3)', async (t) => {
  /* Removing an agent from a project does not unassign it, so tasks.whoOf still names it; its reply would be refused
     as not on the project, so it is not told, and `delivered` says why. */
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  const realAll = projectsEngine.readAll;
  const realSay = tasksEngine.say;
  const realWho = tasksEngine.whoOf;
  projectsEngine.readAll = () => [{ id: 'p4491', name: 'p4491', agents: ['mara'] }];
  tasksEngine.say = (id, num) => ({ number: Number(num) });
  tasksEngine.whoOf = () => ['mara', 'gone-agent'];
  t.after(() => { projectsEngine.readAll = realAll; tasksEngine.say = realSay; tasksEngine.whoOf = realWho; board.restore(); });
  const r = await call('POST', '/api/project/p4491/task/1/message', { headers: { 'x-kosmos-board-token': BOARD, 'sec-fetch-site': 'same-origin', origin: base }, body: { text: 'from the person' } });
  assert.equal(r.code, 200, r.text.slice(0, 160));
  const delivered = JSON.parse(r.text).delivered;
  assert.deepEqual(delivered.map((d) => d.agent).sort(), ['gone-agent', 'mara'], 'expected exactly one entry per assignee: ' + JSON.stringify(delivered));
  const gone = delivered.find((d) => d.agent === 'gone-agent');
  assert.ok(gone && /not on this project any more/.test(gone.because), 'the departed assignee was told, or not said: ' + JSON.stringify(delivered));
  /* CONTROL: the member is still sent the notification (whatever its delivery outcome), so the filter is membership. */
  const mara = delivered.find((d) => d.agent === 'mara');
  assert.ok(mara && !/not on this project/.test(mara.because || ''), 'control: the member was filtered too: ' + JSON.stringify(delivered));
});

test('membership is exact for a carded agent, and by key only for a token that resolved without a roster row (#4491 slice 3)', async (t) => {
  const board = fleet.install([fleet.agent('poc-agent', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  const liveness = require('./engine/liveness');
  const realAll = projectsEngine.readAll;
  const realSay = tasksEngine.say;
  const realWho = tasksEngine.whoOf;
  const realAlive = liveness.alive;
  let stored = ['Mara'];
  const said = [];
  projectsEngine.readAll = () => [{ id: 'p4491', name: 'p4491', agents: stored }];
  tasksEngine.say = (id, num, text) => { said.push(text); return { number: Number(num) }; };
  tasksEngine.whoOf = () => [];
  liveness.alive = (key) => (key === 'ghost' ? true : realAlive(key));   // a live agent with no roster row
  t.after(() => { projectsEngine.readAll = realAll; tasksEngine.say = realSay; tasksEngine.whoOf = realWho; liveness.alive = realAlive; board.restore(); });
  const send = (tok, text) => call('POST', '/api/project/p4491/task/1/message', { headers: { 'x-kosmos-agent-token': tok }, body: { text } });
  // A carded agent is compared exactly: "Mara" on the record is not the roster's "mara".
  assert.equal((await send(sendertoken.mint('mara').token, 'carded')).code, 403, 'a look-alike stored name admitted a carded agent');
  // A paneless token names its agent by store.safeKey, so it is matched by key: "Ghost" on the record is "ghost".
  stored = ['Ghost'];
  const ghost = sendertoken.mint('ghost').token;
  const r = await send(ghost, 'paneless');
  assert.equal(r.code, 200, 'a paneless member was refused: ' + r.code + ' ' + r.text.slice(0, 160));
  // CONTROL: the same paneless agent against a record without it is refused, so the 200 above is the key match.
  stored = ['Mara'];
  assert.equal((await send(ghost, 'not on it')).code, 403);
  assert.deepEqual(said, ['paneless']);
});

test('task built refuses a token-only agent that is not on the project (#4491 slice 3)', async (t) => {
  const board = fleet.install([fleet.agent('poc-agent', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  const realAll = projectsEngine.readAll;
  const realSet = tasksEngine.setBuilt;
  const marks = [];
  projectsEngine.readAll = () => [{ id: 'p4491', name: 'p4491', agents: ['mara'] }];
  tasksEngine.setBuilt = (id, num, as) => { marks.push(as.by); return { ok: true, changed: false, task: { number: Number(num) } }; };
  t.after(() => { projectsEngine.readAll = realAll; tasksEngine.setBuilt = realSet; board.restore(); });
  const outsider = await call('POST', '/api/project/p4491/task/1/built', { headers: { 'x-kosmos-agent-token': agentToken }, body: {} });
  assert.equal(outsider.code, 403, 'a non-member marked a task: ' + outsider.code + ' ' + outsider.text.slice(0, 160));
  const member = await call('POST', '/api/project/p4491/task/1/built', { headers: { 'x-kosmos-agent-token': sendertoken.mint('mara').token }, body: {} });
  assert.equal(member.code, 200, 'control: a member could not mark: ' + member.code + ' ' + member.text.slice(0, 160));
  assert.deepEqual(marks, ['mara'], 'the mark was not recorded as the token\'s agent');
});

test('task built: a paneless token is matched by key, and an unreadable project list is a 503 (#4491 slice 3)', async (t) => {
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  const liveness = require('./engine/liveness');
  const realAll = projectsEngine.readAll;
  const realSet = tasksEngine.setBuilt;
  const realAlive = liveness.alive;
  let stored = ['Ghost'];
  let unreadable = false;
  const marks = [];
  projectsEngine.readAll = () => { if (unreadable) { const e = new Error('unreadable'); e.code = 'UNREADABLE'; throw e; } return [{ id: 'p4491', name: 'p4491', agents: stored }]; };
  tasksEngine.setBuilt = (id, num, as) => { marks.push(as.by); return { ok: true, changed: false, task: { number: Number(num) } }; };
  liveness.alive = (key) => (key === 'ghost' ? true : realAlive(key));
  t.after(() => { projectsEngine.readAll = realAll; tasksEngine.setBuilt = realSet; liveness.alive = realAlive; board.restore(); });
  const ghost = sendertoken.mint('ghost').token;
  const mark = () => call('POST', '/api/project/p4491/task/1/built', { headers: { 'x-kosmos-agent-token': ghost }, body: {} });
  const r = await mark();
  assert.equal(r.code, 200, 'a paneless member could not mark: ' + r.code + ' ' + r.text.slice(0, 160));
  stored = ['Mara'];
  assert.equal((await mark()).code, 403, 'control: a paneless non-member marked');
  unreadable = true;
  assert.equal((await mark()).code, 503, 'an unreadable project list was not a 503');
  assert.deepEqual(marks, ['ghost']);
});

test('task message leaves a paneless sender off its own notification, by the same key rule (#4491 slice 3)', async (t) => {
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  const liveness = require('./engine/liveness');
  const realAll = projectsEngine.readAll;
  const realSay = tasksEngine.say;
  const realWho = tasksEngine.whoOf;
  const realAlive = liveness.alive;
  projectsEngine.readAll = () => [{ id: 'p4491', name: 'p4491', agents: ['Ghost', 'mara'] }];
  tasksEngine.say = (id, num) => ({ number: Number(num) });
  tasksEngine.whoOf = () => ['Ghost', 'mara'];
  liveness.alive = (key) => (key === 'ghost' ? true : realAlive(key));
  t.after(() => { projectsEngine.readAll = realAll; tasksEngine.say = realSay; tasksEngine.whoOf = realWho; liveness.alive = realAlive; board.restore(); });
  const r = await call('POST', '/api/project/p4491/task/1/message', { headers: { 'x-kosmos-agent-token': sendertoken.mint('ghost').token }, body: { text: 'from ghost' } });
  assert.equal(r.code, 200, r.text.slice(0, 160));
  const told = JSON.parse(r.text).delivered.map((d) => d.agent);
  assert.ok(!told.includes('Ghost'), 'the paneless sender was notified about its own message: ' + JSON.stringify(told));
  assert.ok(told.includes('mara'), 'control: the other assignee was not notified: ' + JSON.stringify(told));
});

test('a malformed agent token is refused at the gate without a store scan', async (t) => {
  /* Spy on the store scan the gate calls, so this test can see the shape check itself: a malformed
     token must be refused WITHOUT resolveName running, and a well-formed unknown one must run it. */
  const real = sendertoken.resolveName;
  let scans = 0;
  sendertoken.resolveName = (tok) => { scans += 1; return real(tok); };
  t.after(() => { sendertoken.resolveName = real; });
  for (const bad of ['short', 'Z'.repeat(64), agentToken + '0']) {
    assert.ok(refusedAtGate(await call('POST', '/api/whoami', { headers: { 'x-kosmos-agent-token': bad }, body: {} })), 'a malformed token passed: ' + bad.slice(0, 10));
  }
  assert.equal(scans, 0, 'a malformed token still scanned the token store');
  assert.ok(refusedAtGate(await call('POST', '/api/whoami', { headers: { 'x-kosmos-agent-token': 'a'.repeat(64) }, body: {} })));
  assert.ok(scans > 0, 'control: a well-formed unknown token did not reach the store scan, so the spy sees nothing');
});

test('a revoked agent token no longer opens the gate', async () => {
  const gone = sendertoken.mint('gone-agent');
  assert.ok(gone.ok);
  assert.ok(!refusedAtGate(await call('POST', '/api/whoami', { headers: { 'x-kosmos-agent-token': gone.token }, body: {} })), 'control: the fresh token passes');
  sendertoken.revoke('gone-agent');
  assert.ok(refusedAtGate(await call('POST', '/api/whoami', { headers: { 'x-kosmos-agent-token': gone.token }, body: {} })), 'a revoked token still passes the gate');
});

test('the board token still works on the agent routes (nothing that works today breaks)', async () => {
  const r = await call('POST', '/api/whoami', { headers: { 'x-kosmos-board-token': BOARD }, body: {} });
  assert.ok(!refusedAtGate(r), 'the board token no longer reaches whoami');
});

test.after(() => {
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

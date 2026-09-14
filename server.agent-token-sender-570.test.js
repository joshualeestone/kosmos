'use strict';
/**
 * #570: /api/msg names its sender from a presented AGENT TOKEN, not only a pane.
 *
 * 🛑 A Windows agent has no tmux pane, and the msg/post/react routes were
 * pane-only, so `kosmos msg` from a Windows agent could never say who it was --
 * even carrying the per-run token its supervisor puts in its environment. Driven
 * through the real server and the real sendertoken store.
 *
 *   node --test server.agent-token-sender-570.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agent-token-570-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agent-token-570-home-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agent-token-570-work-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agent-token-570-proj-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agent-token-570-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
/* kosmos#1651: DRY_RUN stops tmux WRITES; the roster is a READ and only TMUX_BIN
   redirects one, so the whole-sandbox guard requires it. */
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const messagesEngine = require('./engine/messages');
const chatEngine = require('./engine/chat');

test.before(async () => { await start(0); });
test.after(() => {
  server.closeAllConnections(); server.close();
  for (const d of [SANDBOX, process.env.HOME]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

async function postMsg(body, headers) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/msg`, {
    method: 'POST',
    headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

/* A board with leo and mara, and a chat runner that records what would be typed
   into mara's pane instead of reaching tmux. */
function boardWithTwo(t) {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  const sends = [];
  chatEngine.setRunner((args) => {
    sends.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chatEngine.setDryRun(false);
  t.after(() => { messagesEngine.resetForTests(); chatEngine.setRunner(null); chatEngine.setDryRun(true); board.restore(); });
  return sends;
}

test('an agent with NO pane but a valid agent token is named as the sender', async (t) => {
  const sends = boardWithTwo(t);
  const tok = sendertoken.mint('leo').token;
  const r = await postMsg({ to: 'mara', text: 'from a windows agent', from_pane: '' }, { 'x-kosmos-agent-token': tok });
  assert.equal(r.status, 200);
  assert.equal(r.json.delivery.state, 'placed', 'the token-carrying send was not delivered: ' + (r.json.delivery.because || ''));
  const typed = sends.filter((a) => a[0] === 'send-keys');
  assert.match(String(typed[0] && typed[0][5]), /colleague leo/, 'the envelope does not name the token\'s agent');
});

test('no token and no pane: the same refusal as before, untouched', async (t) => {
  boardWithTwo(t);
  const r = await postMsg({ to: 'mara', text: 'who am I', from_pane: '' });
  assert.equal(r.json.delivery.state, 'could_not');
  assert.match(r.json.delivery.because, /cannot tell which agent is sending this/);
});

test('a presented token that does not resolve is REFUSED, never swapped for the pane it came with', async (t) => {
  boardWithTwo(t);
  const r = await postMsg({ to: 'mara', text: 'spoof', from_pane: '%3' }, { 'x-kosmos-agent-token': '0'.repeat(64) });
  assert.equal(r.json.delivery.state, 'could_not', 'a bad credential fell back to the weaker pane path');
});

test('the post and react routes resolve a token sender through the same helper', () => {
  /* Their full path needs a project fixture; what matters here is that both
     routes consult the token BEFORE the pane, through senderFromAgentToken. The
     engine half (sendPost honouring a resolved sender) is tested directly below. */
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const post = src.slice(src.indexOf("pathname === '/api/post'"), src.indexOf("pathname === '/api/react'"));
  /* #1704 PR2: the route hands the token sender to sendRoomPostAsAgent (shared
     with the outbox drain), which refuses a token that did not resolve after the
     project check and otherwise passes it to sendPost. Pin both halves. */
  assert.match(post, /sendRoomPostAsAgent\(\{[^}]*sender: senderFromAgentToken\(req, body, roster\)/);
  const shared = src.slice(src.indexOf('function sendRoomPostAsAgent('), src.indexOf('function agentBelongsToThisKosmos('));
  assert.match(shared, /if \(sender && !sender\.ok\) return \{ state: 'could_not', because: sender\.because \}/);
  assert.match(shared, /messages\.sendPost\(\{[^}]*\bsender,/);
  const react = src.slice(src.indexOf("pathname === '/api/react'"), src.indexOf('/api/agent/:name/conversation'));
  assert.match(react, /senderFromAgentToken\(req, body, roster\) \|\| messages\.resolveSender/);
});

test('#2908: reply_expected threads route -> sendRoomPostAsAgent -> sendPost, AND the outbox drain forwards it', () => {
  /* Same wiring-assertion approach as the test above (a full room fixture is heavy; the behavior
     of replyExpected:false -> no-reply note is proven directly against sendPost in
     engine/messages.test.js). What this pins is the THREADING, including the outbox drain, which a
     blind review found dropping the field (a kept `kosmos post --no-reply` replayed on drain would
     otherwise be reply-required again and reopen the ack loop for the kept-agent case). */
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const post = src.slice(src.indexOf("pathname === '/api/post'"), src.indexOf("pathname === '/api/react'"));
  // The route validates reply_expected as a strict boolean (refuse non-boolean) and passes it through.
  assert.match(post, /'reply_expected' in body && typeof body\.reply_expected !== 'boolean'/);
  assert.match(post, /replyExpected: body\.reply_expected/);
  // The shared helper forwards it to sendPost.
  const shared = src.slice(src.indexOf('function sendRoomPostAsAgent('), src.indexOf('function agentBelongsToThisKosmos('));
  assert.match(shared, /messages\.sendPost\(\{[^}]*\breplyExpected,/);
  // THE DRAIN forwards it too: this arm reds if deliverPost drops entry.body.reply_expected.
  const drain = src.slice(src.indexOf('deliverPost: (entry) =>'), src.indexOf('onExpired:'));
  assert.match(drain, /replyExpected: entry\.body\.reply_expected/, 'the outbox drain must forward reply_expected, or a kept --no-reply post replays reply-required');
});

test('sendPost and send use a sender the route already resolved, and resolve from the pane otherwise', (t) => {
  /* The card comes from test-support/fleet, never typed by hand (fixture-discipline). */
  const board = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  t.after(() => board.restore());
  const card = board.roster.find((c) => c.sessionName === 'leo');
  const sent = messagesEngine.send({ sender: { ok: true, card }, to: 'nobody-by-this-name', text: 'x' }, []);
  assert.doesNotMatch(String(sent.because), /cannot tell which agent/, 'send ignored the resolved sender');
  const posted = messagesEngine.sendPost({ sender: { ok: true, card }, project: 'no-such', projectName: 'x', text: 'x' }, [], []);
  assert.doesNotMatch(String(posted.because), /cannot tell which agent/, 'sendPost ignored the resolved sender');
  const bare = messagesEngine.send({ to: 'x', text: 'x' }, []);
  assert.match(bare.because, /cannot tell which agent/, 'control: with no sender and no pane the old refusal stands');
});

test('msg, post and react stay BEHIND the board-token gate: neither exempt set may name them', () => {
  /* What makes accepting an agent token here safe is that the caller must ALSO
     hold the board token (only report and reply are exempt, for remote agents).
     Adding these routes to either set would let a bare agent token speak. */
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  for (const set of ['REMOTE_AGENT_ROUTES', 'LOOPBACK_AGENT_ROUTES']) {
    const line = (src.match(new RegExp('const ' + set + ' = new Set\\(\\[[^\\]]*\\]\\)')) || [''])[0];
    assert.ok(line, set + ' moved; this pin reads nothing');
    for (const route of ['/api/msg', '/api/post', '/api/react']) {
      assert.ok(!line.includes(route), route + ' is now exempt from the board token via ' + set);
    }
  }
});

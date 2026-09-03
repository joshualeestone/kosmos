'use strict';

/**
 * #1968: on an ENFORCING board, POST /api/report and /api/reply must not trust a
 * bare `from_pane` (a NO-CREDENTIAL path). That fallback is exactly how a second
 * macOS account spoofs a report/reply over the shared loopback -- report/reply
 * are exempt from #1946's board-token dispatch gate (a remote agent reaches them
 * with an agent token), so before this the pane fallback let a local process with
 * no credential post as any agent whose (enumerable) pane it named.
 *
 * The fix requires the board token OR an agent token and DROPS the pane fallback,
 * ONLY on an enforcing board. On a non-enforcing (fully-sandboxed) board the pane
 * fallback is unchanged -- which is what keeps the whole test/browser-check suite
 * green. This file proves both directions with a control that returns the
 * dangerous answer: the SAME bare-pane request is ACCEPTED when not enforcing and
 * REFUSED when enforcing, so the refusal is the new guard firing, not a broken
 * route.
 *
 * Same posture as server.board-auth-1946.test.js: boot fully-sandboxed (so
 * requiring server.js writes nothing real), then flip enforcement on in memory
 * via the exported `boardAuthState`. The pane->session map is the real
 * `messages.setRunner` seam the sibling reply tests in server.test.js use.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1968-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server, boardAuthState } = require('./server');
const fleet = require('./test-support/fleet');
const messages = require('./engine/messages');
const sendertoken = require('./engine/sendertoken');
const liveness = require('./engine/liveness');

const TOK = 'BOARDTOKEN_1968_0123456789abcdef';
let base;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  // Booted fully-sandboxed, so enforcement is OFF. Confirm it (the zero-churn
  // property this fix rests on), then each test sets `on` explicitly.
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.token = TOK;
});

// A real fleet with one tied agent (leo), and the pane->session runner the
// sibling reply tests use, so `from_pane: '%3'` resolves to leo. Rebuilt per
// test so state does not leak between them.
function withLeo(fn) {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
  return Promise.resolve()
    .then(() => fn())
    .finally(() => { messages.setRunner(null); board.restore(); });
}

async function post(p, { headers = {}, body }) {
  const res = await fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await res.text().catch(() => '');
  let json = {};
  try { json = JSON.parse(text); } catch { /* leave {} */ }
  return { code: res.status, json, text };
}

const bareReport = { state: 'idle', from_pane: '%3' };
const bareReply = { text: 'on it, back in two minutes', from_pane: '%3' };

test('CONTROL: on a NON-enforcing board a bare-pane report/reply IS accepted (proves the request is otherwise valid)', async () => {
  boardAuthState.on = false;
  await withLeo(async () => {
    const rep = await post('/api/report', { body: bareReport });
    assert.equal(rep.json.recorded, true, 'a bare-pane report must be recorded on a non-enforcing board: ' + rep.text);
    const rpl = await post('/api/reply', { body: bareReply });
    assert.equal(rpl.json.kept, true, 'a bare-pane reply must be kept on a non-enforcing board: ' + rpl.text);
  });
});

test('THE FIX: on an ENFORCING board a bare-pane report/reply with NO credential is REFUSED (the #1968 cross-account spoof)', async () => {
  boardAuthState.on = true;
  await withLeo(async () => {
    // The dispatch gate still lets report/reply THROUGH (they are exempt); the
    // refusal is at the sender-resolution layer, so it is a 200 with the
    // recorded/kept flag false, not a 403.
    const rep = await post('/api/report', { body: bareReport });
    assert.equal(rep.code, 200, rep.text);
    assert.equal(rep.json.recorded, false, 'DANGEROUS: a no-credential bare-pane report was recorded on an enforcing board');
    const rpl = await post('/api/reply', { body: bareReply });
    assert.equal(rpl.code, 200, rpl.text);
    assert.equal(rpl.json.kept, false, 'DANGEROUS: a no-credential bare-pane reply was kept on an enforcing board');
  });
});

test('BOARD-TOKEN arm: on an enforcing board a valid board token lets the same-account pane fallback through', async () => {
  boardAuthState.on = true;
  await withLeo(async () => {
    const hdr = { 'x-kosmos-board-token': TOK };
    const rep = await post('/api/report', { headers: hdr, body: bareReport });
    assert.equal(rep.json.recorded, true, 'a valid board token must record a report on an enforcing board: ' + rep.text);
    const rpl = await post('/api/reply', { headers: hdr, body: bareReply });
    assert.equal(rpl.json.kept, true, 'a valid board token must keep a reply on an enforcing board: ' + rpl.text);
  });
});

test('a WRONG board token is not a credential: still refused on an enforcing board', async () => {
  boardAuthState.on = true;
  await withLeo(async () => {
    const hdr = { 'x-kosmos-board-token': 'not-the-token' };
    const rep = await post('/api/report', { headers: hdr, body: bareReport });
    assert.equal(rep.json.recorded, false, 'a wrong board token must not record a report');
    const rpl = await post('/api/reply', { headers: hdr, body: bareReply });
    assert.equal(rpl.json.kept, false, 'a wrong board token must not keep a reply');
  });
});

test('AGENT-TOKEN arm: on an enforcing board a valid agent token passes WITHOUT a board token', async () => {
  boardAuthState.on = true;
  await withLeo(async () => {
    // A live agent token for leo. resolveAgentSender takes the token arm before
    // ever reaching the pane fallback, so the board token is not needed.
    const agentTok = sendertoken.mint('leo').token;
    try {
      liveness.seen('leo');
      const hdr = { 'x-kosmos-agent-token': agentTok };
      const rep = await post('/api/report', { headers: hdr, body: bareReport });
      assert.equal(rep.json.recorded, true, 'a valid agent token must record a report on an enforcing board without a board token: ' + rep.text);
      const rpl = await post('/api/reply', { headers: hdr, body: bareReply });
      assert.equal(rpl.json.kept, true, 'a valid agent token must keep a reply on an enforcing board without a board token: ' + rpl.text);
    } finally {
      sendertoken.revoke('leo');
    }
  });
});

test.after(() => {
  boardAuthState.on = false;
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

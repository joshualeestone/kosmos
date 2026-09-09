'use strict';
/**
 * kosmos#2575: POST /api/agent/:sessionName/clear-selfreport, over HTTP.
 *
 * The Projects page surfaces a REPORTED needs_you and a reported needs_you never
 * decays. The only intended clear is the agent reporting a non-auto state
 * itself; an agent that raised needs_you, resumed work, and never self-cleared
 * leaves a sticky red with no operator-side dismiss. This route is that dismiss.
 *
 * 🔑 OPERATOR-ONLY by construction: it is under /api/, so the sensitive-route
 * gate requires the BOARD TOKEN, and it is deliberately OUT of
 * REMOTE_AGENT_ROUTES / LOOPBACK_AGENT_ROUTES. The last test flips enforcement
 * on and proves a no-token POST is refused while a token POST is not -- the
 * dangerous answer (an unauthenticated clear) refused, with a control.
 *
 * 🛑 THE DISCRIMINATING CONTROL: a clear must LAND over a standing needs_you
 * that an AUTOMATIC idle CANNOT clear (#900). If the operator path had opened
 * that guard, or if it merely rode the same refusal, the pass would be vacuous.
 * So one test seeds a needs_you, shows an auto idle is refused, and only then
 * shows the route clears it.
 *
 * Same sandbox posture as server.work-marker-2146.test.js: boot fully
 * sandboxed (enforcement OFF), then drive real requests over loopback.
 *
 *   node --test server.clear-selfreport-2575.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-2575-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server, boardAuthState } = require('./server');
const fleet = require('./test-support/fleet');
const selfreport = require('./engine/selfreport');
const messages = require('./engine/messages');

const TOK = 'BOARDTOKEN_test_0123456789abcdef';
let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce (this keeps the functional tests token-free)');
});
test.after(() => { try { server.close(); } catch { /* best effort */ } });

// Run fn with `name` installed as one of ours in the pane roster, so
// knownAgent(name) is true. The board keys selfreport by the bare board name
// (status.js reads selfreport.read(pane.name)), which is exactly the sessionName
// the roster reports and the URL segment carries -- so the route reads/writes
// the same file the board shows. fn receives that bare name.
function withAgent(name, fn) {
  const board = fleet.install([fleet.agent(name, { state: 'idle' })]);
  return Promise.resolve().then(() => fn(name)).finally(() => board.restore());
}

async function clearPost(session, { token, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-kosmos-board-token'] = token;
  const res = await fetch(base + '/api/agent/' + encodeURIComponent(session) + '/clear-selfreport', {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {}),
    redirect: 'manual',
  });
  const text = await res.text().catch(() => '');
  let json = {}; try { json = JSON.parse(text); } catch { /* {} */ }
  return { code: res.status, json, text };
}

test('a WAITING agent is cleared: cleared:true, state idle, by operator, and the record is written', async () => {
  await withAgent('cs-waiting', async (session) => {
    selfreport.record(session, { state: 'needs_you', because: 'permission to run Bash' });
    const r = await clearPost(session);
    assert.equal(r.code, 200, r.text);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.cleared, true, 'a standing needs_you must be cleared');
    assert.equal(r.json.state, 'idle');
    assert.equal(r.json.by, 'operator');
    // The record itself moved, not just the response.
    const back = selfreport.read(session);
    assert.equal(back.state, 'idle', 'the operator idle superseded the needs_you in the record');
    assert.equal(back.by, 'operator');
  });
});

test('THE DISCRIMINATING CONTROL: the clear lands where an AUTOMATIC idle is refused (#900 not weakened)', async () => {
  await withAgent('cs-control', async (session) => {
    selfreport.record(session, { state: 'needs_you', because: 'a real blocker' });
    // An automatic idle must NOT clear it -- proves the state is genuinely sticky.
    const auto = selfreport.record(session, { state: 'idle', because: 'end of turn', auto: true });
    assert.equal(auto.recorded, false, 'CONTROL: an automatic idle must be refused over the standing needs_you');
    assert.equal(selfreport.read(session).state, 'needs_you', 'still waiting after the refused auto idle');
    // The operator route DOES clear the very state the machine could not.
    const r = await clearPost(session);
    assert.equal(r.json.cleared, true, 'the operator route clears the state an auto idle could not');
    assert.equal(selfreport.read(session).state, 'idle');
  });
});

test('a NON-waiting agent is an idempotent no-op: cleared:false, ok:true, the current state reported', async () => {
  await withAgent('cs-idle', async (session) => {
    selfreport.record(session, { state: 'working', because: 'building' });
    const r = await clearPost(session);
    assert.equal(r.code, 200, r.text);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.cleared, false, 'nothing sticky to clear');
    assert.equal(r.json.state, 'working', 'the fresh state is reported back');
    assert.equal(selfreport.read(session).state, 'working', 'a no-op must not write anything');
  });
});

test('an agent that NEVER reported is a no-op too: cleared:false, state null', async () => {
  await withAgent('cs-silent', async (session) => {
    const r = await clearPost(session);
    assert.equal(r.code, 200, r.text);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.cleared, false);
    assert.equal(r.json.state, null, 'a never-reported agent has no state to report');
  });
});

test('a second clear is idempotent: the first clears, the second is a cleared:false no-op', async () => {
  await withAgent('cs-twice', async (session) => {
    selfreport.record(session, { state: 'needs_you', because: 'x' });
    const first = await clearPost(session);
    assert.equal(first.json.cleared, true);
    const second = await clearPost(session);
    assert.equal(second.json.cleared, false, 'the state is already idle, so the second click clears nothing');
    assert.equal(second.json.state, 'idle');
  });
});

test('an UNKNOWN agent is refused 404 ok:false, never a silent success', async () => {
  const r = await clearPost('not-an-agent-at-all');
  assert.equal(r.code, 404, r.text);
  assert.equal(r.json.ok, false);
  assert.ok(r.json.because, 'a refusal must say why');
});

test('an operator-supplied reason is stored as the because', async () => {
  await withAgent('cs-reason', async (session) => {
    selfreport.record(session, { state: 'needs_you', because: 'x' });
    const r = await clearPost(session, { body: { reason: 'cleared after standup' } });
    assert.equal(r.json.cleared, true);
    assert.equal(selfreport.read(session).because, 'cleared after standup');
  });
});

// The forgery invariant this whole route rests on: `by:'operator'` is a provenance
// only the operator-only clear route may set. It must NOT be forgeable through the
// AGENT-facing /api/report route -- if that route ever forwarded a client-supplied
// `by`, an agent could stamp its own report `operator` and (because operator is
// auto-falsey) land it over a standing needs_you, defeating the #900 guard. The
// route does not read body.by today; this test RED-GUARDS that so a future
// regression adding `by: body.by` to the report handler fails loudly.
test('FORGERY GUARD: /api/report with a client-supplied by:operator still stores by:agent (the invariant the clear route rests on)', async () => {
  const name = 'cf-forge';
  const board = fleet.install([fleet.agent(name, { state: 'idle' })]);
  messages.setRunner(() => ({ ok: true, session: `${name}-discord` }));
  try {
    const res = await fetch(base + '/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // A hostile report: a deliberate agent report that TRIES to stamp itself operator.
      body: JSON.stringify({ state: 'working', text: 'forging provenance', from_pane: 'x', by: 'operator' }),
      redirect: 'manual',
    });
    const j = await res.json().catch(() => ({}));
    assert.equal(j.recorded, true, 'the report itself records: ' + JSON.stringify(j));
    const back = selfreport.read(name);
    assert.equal(back.state, 'working');
    assert.equal(back.by, 'agent', 'a client-supplied by:operator through /api/report must NOT be honored -- only the operator-only clear route may set operator provenance');
  } finally {
    messages.setRunner(null);
    board.restore();
  }
});

// LAST: enforcement on. Everything above ran token-free on a non-enforcing
// board; here the board demands the token, so this file cannot fall back to the
// functional tests after it. Restored in the finally so a later file is unaffected.
test('AUTH: an enforcing board REFUSES a no-token clear (403) and ADMITS a token clear', async () => {
  boardAuthState.on = true;
  boardAuthState.token = TOK;
  try {
    await withAgent('cs-auth', async (session) => {
      selfreport.record(session, { state: 'needs_you', because: 'x' });
      const refused = await clearPost(session);
      assert.equal(refused.code, 403, 'a clear with no board token must be refused on an enforcing board: ' + refused.text);
      assert.equal(selfreport.read(session).state, 'needs_you', 'a refused clear must not have written anything');

      const ok = await clearPost(session, { token: TOK });
      assert.notEqual(ok.code, 403, 'a valid board token must pass the gate');
      assert.equal(ok.json.cleared, true, 'and clear the standing needs_you');
    });
  } finally {
    boardAuthState.on = false;
    boardAuthState.token = null;
  }
});

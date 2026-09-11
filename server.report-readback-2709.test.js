'use strict';

/**
 * #2709: `GET /api/report` reads back THIS agent's own current board state.
 *
 * `kosmos report` was write-only, so an agent could set its state (incl a
 * needs_you it is TOLD to clear once answered) but never check it -- and memory
 * of it does not survive a compaction. The new read-back returns ONLY the
 * caller's own report, authenticated exactly like POST /api/report
 * (resolveAgentSender, token-first then pane), so it is never a window onto the
 * roster (that stays account-gated).
 *
 * Same sandbox posture as server.liveness-refused-2558.test.js.
 *
 *   node --test server.report-readback-2709.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-2709-'));
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
const selfreport = require('./engine/selfreport');
const liveness = require('./engine/liveness');

const TOK = 'BOARDTOKEN_2709_0123456789abcdef';
const WHO = 'leo';   // sender.card.sessionName for the fleet 'leo' agent
let base;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.token = TOK;
});

function clearStores() {
  for (const dir of [sendertoken.DIR, liveness.DIR, selfreport.DIR]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* not there yet */ }
  }
}
test.beforeEach(clearStores);

function withLeo(fn) {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
  return Promise.resolve().then(() => fn()).finally(() => { messages.setRunner(null); board.restore(); });
}

async function post(p, { headers = {}, body }) {
  const res = await fetch(base + p, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body), redirect: 'manual',
  });
  const text = await res.text().catch(() => '');
  let json = {}; try { json = JSON.parse(text); } catch { /* leave {} */ }
  return { code: res.status, json, text };
}
async function get(p, { headers = {} } = {}) {
  const res = await fetch(base + p, { method: 'GET', headers, redirect: 'manual' });
  const text = await res.text().catch(() => '');
  let json = {}; try { json = JSON.parse(text); } catch { /* leave {} for as=text */ }
  return { code: res.status, json, text, type: res.headers.get('content-type') || '' };
}

test('ROUND-TRIP: a posted needs_you reads back with the SAME state (JSON), and the text arm agrees', async () => {
  boardAuthState.on = false;
  await withLeo(async () => {
    const tok = sendertoken.mint(WHO).token;
    try {
      const wrote = await post('/api/report', { headers: { 'x-kosmos-agent-token': tok }, body: { state: 'needs_you', on: 'the trial length', owner: 'josh' } });
      assert.equal(wrote.json.recorded, true, 'the needs_you must record so it can be read back: ' + wrote.text);

      const jr = await get('/api/report', { headers: { 'x-kosmos-agent-token': tok } });
      assert.equal(jr.code, 200, 'JSON read-back status: ' + jr.text);
      assert.equal(jr.json.ok, true, 'read-back not ok: ' + jr.text);
      assert.equal(jr.json.report.found, true, 'the read-back did not find the report just written');
      assert.equal(jr.json.report.state, 'needs_you', 'the read-back carried the WRONG state: ' + jr.text);
      assert.equal(jr.json.report.on, 'the trial length', 'the read-back dropped --on');

      const tr = await get('/api/report?as=text', { headers: { 'x-kosmos-agent-token': tok } });
      assert.equal(tr.code, 200, 'text read-back status');
      assert.match(tr.type, /text\/plain/);
      assert.match(tr.text, /needs_you/, 'the text arm did not name the current state');
      assert.match(tr.text, /waiting-on-a-person/i, 'the text arm did not flag needs_you as a waiting-on-a-person state (the motivating "is it still set")');
    } finally { sendertoken.revoke(WHO); }
  });
});

test('NO REPORT YET: an agent that never reported gets found:false at 200, not a 500', async () => {
  boardAuthState.on = false;
  await withLeo(async () => {
    const tok = sendertoken.mint(WHO).token;
    try {
      const jr = await get('/api/report', { headers: { 'x-kosmos-agent-token': tok } });
      assert.equal(jr.code, 200, 'a no-report agent must be 200, never 500: ' + jr.text);
      assert.equal(jr.json.ok, true);
      assert.equal(jr.json.report.found, false, 'a never-reported agent must read found:false');
      assert.ok(jr.json.report.because, 'found:false must carry a because saying why');
      const tr = await get('/api/report?as=text', { headers: { 'x-kosmos-agent-token': tok } });
      assert.equal(tr.code, 200);
      assert.doesNotMatch(tr.text, /You are currently:/, 'a no-report agent must not read as having a state');
    } finally { sendertoken.revoke(WHO); }
  });
});

test('ENFORCING BOARD + valid agent token: the read-back still returns the report (200) -- the real production path', async () => {
  // The round-trip above runs on a non-enforcing board (denyPaneFallback=false).
  // This exercises the actual deployed shape: an enforcing board where the token
  // arm must short-circuit the pane fallback and still authorize the read.
  boardAuthState.on = true;
  try {
    await withLeo(async () => {
      const tok = sendertoken.mint(WHO).token;
      try {
        const wrote = await post('/api/report', { headers: { 'x-kosmos-agent-token': tok }, body: { state: 'blocked', on: 'a decision' } });
        assert.equal(wrote.json.recorded, true, 'the report must record on an enforcing board with a valid token: ' + wrote.text);
        const jr = await get('/api/report', { headers: { 'x-kosmos-agent-token': tok } });
        assert.equal(jr.code, 200, 'enforcing board + valid token must still read back (200): ' + jr.text);
        assert.equal(jr.json.ok, true);
        assert.equal(jr.json.report.found, true, 'the token-authed read on an enforcing board did not find the report');
        assert.equal(jr.json.report.state, 'blocked', 'the read-back carried the wrong state on an enforcing board');
      } finally { sendertoken.revoke(WHO); }
    });
  } finally { boardAuthState.on = false; }
});

test('SECURITY: an unresolved caller (enforcing board, bare pane, no token) is refused -- it cannot read a report', async () => {
  boardAuthState.on = true;
  try {
    await withLeo(async () => {
      const jr = await get('/api/report?from_pane=%253', {});   // %253 decodes to the tmux pane %3
      // A REAL 403, not a 200: cmd_report_show keys its exit-1 off the HTTP
      // status (4xx/5xx), so a refusal MUST be a 4xx or the CLI exits 0 and an
      // agent cannot tell refused from success (parity with post/react/room).
      assert.equal(jr.code, 403, 'a refused read must be 403, not 200 -- the CLI exit depends on it: ' + jr.text);
      assert.equal(jr.json.ok, false, 'a no-credential caller on an enforcing board must be refused, not handed a report: ' + jr.text);
      assert.ok(!jr.json.report, 'an unresolved caller must NOT receive any report');
      assert.ok(jr.json.because, 'the refusal must say why');
    });
  } finally { boardAuthState.on = false; }
});

test.after(() => {
  boardAuthState.on = false;
  try { server.close(); } catch { /* ignore */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

'use strict';

/**
 * #2558: the report-route liveness beat must fire for any AUTHENTICATED report,
 * whether or not its STATE was recorded.
 *
 * The beat used to sit AFTER the recorded-state early-return, so a refused-state
 * report -- a #900 automatic `working` over a standing needs_you -- proved life
 * yet never beat liveness. A PANELESS agent working under a sticky needs_you (its
 * only roster tie is `liveness.alive`, #2146's own population) could then go stale
 * and drop off the board while alive and reporting. The fix moves the beat to
 * BEFORE the early-return, beside the #2146 activity marker, and it stays
 * AUTH-gated so an unauthenticated report still cannot beat liveness (#1968).
 *
 * Same sandbox posture as server.report-reply-loopback-1968.test.js.
 *
 *   node --test server.liveness-refused-2558.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-2558-'));
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

const TOK = 'BOARDTOKEN_2558_0123456789abcdef';
const WHO = 'leo';                 // sender.card.sessionName for the fleet 'leo' agent
const HOUR = 3600e3;
let base;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.token = TOK;
});

// Each test starts from empty stores, so a report's effect (or refusal) here is
// this test's own arrangement, not a leftover from the one before -- otherwise a
// prior accepted `working` leaves leo classified working and the fleet fixture,
// which asks for `idle`, refuses.
function clearStores() {
  for (const dir of [sendertoken.DIR, liveness.DIR, selfreport.DIR]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* not there yet */ }
  }
}
test.beforeEach(clearStores);

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

const stale = () => new Date(Date.now() - HOUR).toISOString();

test('POSITIVE CONTROL: an ACCEPTED report beats liveness (the beat works, and WHO is right)', async () => {
  boardAuthState.on = false;
  await withLeo(async () => {
    const tok = sendertoken.mint(WHO).token;
    try {
      liveness.seen(WHO, stale());
      assert.ok(liveness.read(WHO).ageMs > 60e3, 'baseline liveness is stale before the report');
      const rep = await post('/api/report', { headers: { 'x-kosmos-agent-token': tok }, body: { state: 'working' } });
      assert.equal(rep.json.recorded, true, 'a deliberate working must record: ' + rep.text);
      assert.ok(liveness.read(WHO).ageMs < 30e3, 'an accepted report beat liveness (age ' + liveness.read(WHO).ageMs + 'ms)');
    } finally { sendertoken.revoke(WHO); }
  });
});

test('THE FIX: an authenticated report whose STATE is REFUSED (#900 auto-working over a standing needs_you) STILL beats liveness', async () => {
  boardAuthState.on = false;
  await withLeo(async () => {
    const tok = sendertoken.mint(WHO).token;
    try {
      // Stand up a deliberate needs_you (accepted), so an auto-working is refused over it.
      const ny = await post('/api/report', { headers: { 'x-kosmos-agent-token': tok }, body: { state: 'needs_you', text: 'which trial length, 14 or 30 days?' } });
      assert.equal(ny.json.recorded, true, 'the needs_you must record so it can stand: ' + ny.text);
      // Force liveness OLD, so only a NEW beat can freshen it.
      liveness.seen(WHO, stale());
      assert.ok(liveness.read(WHO).ageMs > 60e3, 'liveness baseline is stale');
      // An AUTOMATIC working over the standing needs_you: refused by #900.
      const refused = await post('/api/report', { headers: { 'x-kosmos-agent-token': tok }, body: { state: 'working', auto: true } });
      // CONTROL: this MUST be the refused path, or the test proves nothing about a refused report.
      assert.equal(refused.json.recorded, false, 'the auto-working must be REFUSED over a standing needs_you (else this is not the refused path): ' + refused.text);
      // THE ASSERTION: a refused-but-authenticated report proved life and beat liveness.
      const after = liveness.read(WHO);
      assert.ok(after.found && after.ageMs < 30e3,
        'a refused-state report from an authenticated sender must still beat liveness (age ' + (after.ageMs) + 'ms) -- #2558');
    } finally { sendertoken.revoke(WHO); }
  });
});

test('SECURITY CONTROL: an UNAUTHENTICATED report (enforcing board, bare pane, no token) is refused at auth and does NOT beat liveness (#1968 preserved)', async () => {
  boardAuthState.on = true;
  await withLeo(async () => {
    const old = stale();
    liveness.seen(WHO, old);
    // No credential, bare pane, on an enforcing board -> refused at !sender.ok,
    // before the beat is reached.
    const rep = await post('/api/report', { body: { state: 'working', from_pane: '%3' } });
    assert.equal(rep.json.recorded, false, 'a no-credential report must be refused on an enforcing board: ' + rep.text);
    assert.equal(liveness.read(WHO).at, old, 'an UNAUTHENTICATED report must NOT beat liveness -- the beat stays auth-gated (#1968)');
  });
});

test.after(() => {
  boardAuthState.on = false;
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

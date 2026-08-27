'use strict';
/**
 * A paneless agent can identify itself, and only while it is beating.
 *
 * 🛑 THE POINT: `sendertoken.resolve` ends by finding the agent's CARD in the
 * roster, and the roster is `tmux list-panes`. On a machine with no tmux a
 * VALID token resolves to nothing, so the agent cannot report, cannot reply,
 * and cannot appear. `resolveAgentSender` adds a second evidence path -- a
 * name plus a LIVE HEARTBEAT -- without weakening the first.
 *
 *   node --test server.paneless-sender.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-paneless-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const sendertoken = require('./engine/sendertoken');
const liveness = require('./engine/liveness');
const fleet = require('./test-support/fleet');

/* The helper is not exported -- server.js is a running server, not a module.
   Read it out of the source and evaluate it against the same engine modules
   the server uses, so this tests the SHIPPED text rather than a copy. */
function loadHelper() {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const start = src.indexOf('function resolveAgentSender(req, body, roster) {');
  assert.ok(start > 0, 'resolveAgentSender is gone from server.js');
  const end = src.indexOf('\nfunction ', start + 10);
  assert.ok(end > start, 'could not find the end of resolveAgentSender');
  /* ⚠️ NO CARD IN THIS STUB, DELIBERATELY. fixture-discipline flagged the
     first version for hand-building one, and it was right twice over: the
     pane arm below only asserts `.ok`, so the card was never needed. A stub
     that invents a shape is how a suite ends up measuring a world that does
     not exist -- which is the defect that guard was written for. */
  const messages = { resolveSender: (pane) => (pane ? { ok: true } : { ok: false, because: 'no pane' }) };
  // eslint-disable-next-line no-new-func
  return new Function('sendertoken', 'liveness', 'messages', src.slice(start, end) + '\nreturn resolveAgentSender;')(sendertoken, liveness, messages);
}
const resolveAgentSender = loadHelper();
const hdr = (t) => ({ headers: t ? { 'x-kosmos-agent-token': t } : {} });

test('a paneless agent WITH a live heartbeat is identified', () => {
  const tok = sendertoken.mint('paneless-live').token;
  liveness.seen('paneless-live');
  const r = resolveAgentSender(hdr(tok), {}, []);   // empty roster: no panes at all
  assert.equal(r.ok, true, 'refused a beating paneless agent: ' + r.because);
  assert.equal(r.card.sessionName, 'paneless-live');
  assert.equal(r.paneless, true, 'the paneless path was not the one taken');
});

/* 🛑 THE ARM THAT KEEPS THIS FROM BEING A WEAKENING. A token alone must never
   speak for an agent that is not running. */
test('a token WITHOUT a heartbeat is still refused', () => {
  const tok = sendertoken.mint('paneless-silent').token;
  const r = resolveAgentSender(hdr(tok), {}, []);
  assert.equal(r.ok, false,
    'a valid token with NO heartbeat was accepted; a token would then speak for an agent that is not running');
});

test('a heartbeat that has gone stale stops identifying the agent', () => {
  const tok = sendertoken.mint('paneless-stale').token;
  liveness.seen('paneless-stale', new Date(Date.now() - 10 * 60 * 1000).toISOString());
  const r = resolveAgentSender(hdr(tok), {}, []);
  assert.equal(r.ok, false, 'a ten-minute-old heartbeat still identified the agent; a dead one would never leave the board');
});

test('a revoked token cannot use the paneless path either', () => {
  const tok = sendertoken.mint('paneless-revoked').token;
  liveness.seen('paneless-revoked');
  assert.equal(resolveAgentSender(hdr(tok), {}, []).ok, true, 'precondition');
  sendertoken.revoke('paneless-revoked');
  assert.equal(resolveAgentSender(hdr(tok), {}, []).ok, false,
    'a revoked token still identified via the paneless path; revoke would no longer cut an agent off');
});

/* ⚠️ ADDITIVE: a carded agent must take path 1 exactly as before, and every
   Mac agent has no heartbeat record at all. */
/* ⚠️ THE ROSTER COMES FROM test-support/fleet, NOT FROM A LITERAL. The first
   version of this test hand-built `[{ sessionName, isNamedOurs }]` and
   fixture-discipline refused it -- correctly. That guard exists because a
   roster carrying fields `paneRoster()` has never returned once shipped and
   survived six rounds of review.
   📌 I PREDICTED THIS EXACT MISTAKE ON #1112 AT 10:26 -- "the fastest route to
   a green test is a hand-built card that the harness would have refused; if
   phase 1 arrives with one, it should be sent back" -- and then made it. The
   harness caught me, which is the whole reason it is there. */
test('a carded agent is unaffected, and needs no heartbeat', () => {
  const tok = sendertoken.mint('has-a-pane').token;
  const board = fleet.install([fleet.agent('has-a-pane')]);
  const roster = board.roster;
  const r = resolveAgentSender(hdr(tok), {}, roster);
  assert.equal(r.ok, true, 'a normal carded agent was refused: ' + r.because);
  assert.ok(!r.paneless, 'a carded agent took the paneless path');
  assert.equal(liveness.alive('has-a-pane'), null, 'precondition: it has no heartbeat record at all');
  board.restore();
});

test('no token still falls back to the pane, unchanged', () => {
  assert.equal(resolveAgentSender(hdr(null), { from_pane: '%1' }, []).ok, true);
  assert.equal(resolveAgentSender(hdr(null), {}, []).ok, false);
});

/* The disclosure property: an unissued token and an issued-but-silent one
   must read the same, or a probe confirms the token was real. */
test('refusals still read alike, so a probe learns nothing', () => {
  const silent = sendertoken.mint('paneless-quiet').token;
  const a = resolveAgentSender(hdr(silent), {}, []);
  const b = resolveAgentSender(hdr('0'.repeat(64)), {}, []);
  assert.equal(a.because, b.because,
    'a real-but-silent token gives a different message from an unissued one');
});

'use strict';
/*
 * #3446: a LIVE, actively-working Windows CODEX agent shows gray / "Can't tell"
 * (state unknown, confidence none, "it has never reported anything") on the board,
 * even though its win32 stream-state file says `busy`, its supervisor pid is alive,
 * and its ownership record and state file agree on the session id.
 *
 * This drives the REAL board state-composition path end to end -- the same
 * functions the /api state route uses (status.snapshot -> capturePane ->
 * win32capture -> win32live -> win32streamstate.stateFor -> classify ->
 * reconcileReport) -- against a REAL temp store: a real win32-state file stamped
 * `busy` by the actual supervisor publisher, a real ownership record with
 * runner:'codex', and a genuinely-alive supervisor pid (this process's own).
 *
 * The only seam stubbed is `claude agents --json` (an external exe), stubbed to
 * "no claude sessions" -- exactly the box's real state, since a codex agent lists
 * none. Nothing in the layer under test is mocked.
 *
 *   node --test engine/status.codex-state-3446.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-codex-3446-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;

const status = require('./status');
const win32roster = require('./win32roster');
const win32capture = require('./win32capture');
const win32sessions = require('./win32sessions');
const win32streamstate = require('./win32streamstate');

const NAME = 'coder';
const SID = '11111111-1111-4111-8111-111111111111';

test.after(() => {
  status.setPaneSource(null);
  status.setPaneCapture(null);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

function assembleLiveBusyCodexAgent() {
  // 1. The ownership record, exactly as create files a codex launch.
  const rec = win32sessions.record(SID, { name: NAME, runner: 'codex' });
  assert.equal(rec.ok, true, rec.because);

  // 2. The supervisor's OWN presence + state, written by the REAL publisher the
  //    codex supervisor uses. `started` stamps pid+sessionId (idle), a turn's
  //    first event flips it to busy -- the exact write side of the live path.
  //    The supervisor pid is THIS process's pid, so win32orphan.pidAlive is
  //    genuinely true with no stub.
  const pub = win32streamstate.publisher(NAME);
  pub.started(process.pid, SID);
  pub.event({ type: 'assistant' });   // mid-turn -> busy

  // Prove the write side landed the way the read side expects, before composing.
  const token = win32streamstate.stateFor(NAME, { sessionId: SID, pid: process.pid });
  assert.equal(token, 'busy', 'precondition: the state file reads busy for this live session+pid');
  const id = win32streamstate.liveIdentity(NAME);
  assert.deepEqual(id, { pid: process.pid, sessionId: SID }, 'precondition: presence names this supervisor');
}

function wireBoardAsServerDoes() {
  // `run` is the ONLY stub: no claude sessions (a codex box lists none). Record,
  // codex-live, stream-state, pid-liveness, classify and reconcile are all real.
  status.setPaneSource(win32roster.make({ run: () => [] }));
  status.setPaneCapture(win32capture.make({ run: () => [] }));
}

function codexCard() {
  const snap = status.snapshot();
  const card = snap.agents.find((a) => a.sessionName === NAME || a.name === NAME);
  assert.ok(card, 'the codex agent must draw a card at all');
  return card;
}

test('#3446 a live, busy codex agent composes to WORKING on the board (repro)', () => {
  assembleLiveBusyCodexAgent();
  wireBoardAsServerDoes();

  const card = codexCard();
  // The bug: card.state === 'unknown', confidence 'none', "it has never reported anything".
  // The fix: the live busy stream-state reconciles to working with no self-report.
  assert.equal(card.state, 'working',
    `expected working, got ${card.state} / ${card.stateConfidence} / "${card.because}"`);
  assert.notEqual(card.stateConfidence, 'none');
});

test('#3446 the same codex agent reads IDLE when its stream-state is idle', () => {
  // A `result` event ends the turn -> idle. The board must show idle, not gray.
  const pub = win32streamstate.publisher(NAME);
  pub.started(process.pid, SID);
  pub.event({ type: 'result' });
  assert.equal(win32streamstate.stateFor(NAME, { sessionId: SID, pid: process.pid }), 'idle');

  // Fresh capture instance so the prior test's 1500ms busy memo does not serve
  // this read (win32capture collapses a tick's per-pane calls into one window).
  wireBoardAsServerDoes();
  const card = codexCard();
  assert.equal(card.state, 'idle',
    `expected idle, got ${card.state} / ${card.stateConfidence} / "${card.because}"`);
});

test('#3446 Mac-safety: a Mac codex pane (command codex, no win32 mark) still scrapes its screen', () => {
  // The fix must NOT change the Mac/tmux codex path. A Mac codex pane carries
  // command 'codex' (isWin32Pane false), so classify still routes it to the codex
  // screen-scraping arm: an empty-composer screen reads idle, a token would not.
  const macCodexPane = { command: 'codex', runner: 'codex', name: 'macbot', session: 'macbot-discord', claim: 'macbot-discord' };
  const scraped = status.classify(macCodexPane, '› Ask Codex to do anything');
  assert.equal(scraped.state, 'idle', 'a Mac codex pane still classifies from its screen, unchanged');
  // And a win32 token handed to a Mac codex pane is NOT understood as a state
  // (proving the two arms stay distinct): 'busy' is not a codex screen marker.
  const tokenAsScreen = status.classify(macCodexPane, 'busy');
  assert.equal(tokenAsScreen.state, 'unknown', 'the Mac codex arm never reads a win32 token as a state');
});

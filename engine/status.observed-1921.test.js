'use strict';

/*
 * kosmos#1921 -- snapshot() records the LAST OBSERVED real-call outcome per agent
 * (engine/observed): OK from a WITNESSED scrape (scrapedStatus.state === WORKING),
 * REJECTED from status.state === AUTH_FAILED (post-reconcile, inheriting #1930's
 * stale suppression), gated on isNamedOurs AND non-codex. Drives the real snapshot()
 * through test-support/fleet (pane lines built from PANE_COLUMNS by name).
 */

// Sandbox the store BEFORE requiring anything: store.js resolves its root at module
// load, and one test writes a real self-report (selfreport writes under the store root).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-observed-1921-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const status = require('./status');
const selfreport = require('./selfreport');
const observed = require('./observed');
const subscription = require('./subscription');

test.beforeEach(() => {
  observed._clearForTest();
  // Neutralise authprobe's real `claude auth status` subprocess (kicked async for a
  // named-ours auth_failed pane, #1930): loggedIn:false so it says EXPIRED, nothing
  // shells out, and the scraped auth_failed stands this tick.
  subscription.setRunner(async () => ({ stdout: JSON.stringify({ loggedIn: false }), err: null }));
});
test.afterEach(() => {
  fleet.restore();
  subscription.setRunner(null);
  observed._clearForTest();
});

test('a WORKING named-ours pane records an OK observation, an AUTH_FAILED one records 401', () => {
  fleet.install([
    fleet.agent('worka', { state: 'working' }),
    fleet.agent('workb', { state: 'auth_failed' }),
  ]);
  assert.equal((observed.read('worka') || {}).outcome, observed.OUTCOME.OK,
    'a working agent did not record an observed ok: ' + JSON.stringify(observed.all()));
  assert.equal((observed.read('workb') || {}).outcome, observed.OUTCOME.REJECTED,
    'a 401ing agent did not record an observed 401: ' + JSON.stringify(observed.all()));
});

test('#1889: a pane WAITING ON A BACKGROUND AGENT records no observed OK', () => {
  /*
   * 🛑 THE ONE SCRAPED `working` THAT IS NOT A WITNESSED REQUEST.
   *
   * The OK arm above reads the RAW scrape on the stated grounds that a scraped
   * WORKING is "a WITNESSED live streaming turn, direct evidence the token was
   * just accepted for a real request". #1889 added a source of scraped WORKING
   * for which that is false BY CONSTRUCTION: the parent's turn has ENDED, and the
   * row it is read from is a frozen transcript row left behind by a wait. No
   * request is in flight from this pane, and the background agent runs in its own
   * session against its own token.
   *
   * ⚠️ AND THE ASYMMETRY #1966 ALREADY ACCEPTS DOES NOT COVER IT. That comment
   * allows a stale `esc to interrupt` row to record a brief OK, on the reasoning
   * that "the next ~60s sweep re-reads the pane (a finished turn scrapes as idle,
   * not streaming)" so a false green self-heals. A #1889 wait row is EXACTLY the
   * case that breaks that argument: it is frozen, it does not stop rendering when
   * the wait ends, and every subsequent sweep re-reads it as WORKING for as long
   * as it stays within reach of the composer. The green does not self-heal, so
   * the bound the upstream comment relies on is removed rather than merely tested.
   *
   * ⇒ Gated on the STRUCTURAL `backgroundWait` flag the classifier already sets,
   * not on the sentence, so the two cannot drift apart.
   */
  const wait = ['✻ Waiting for 1 background agent to finish', '',
    '────', '❯ ', '────',
    '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents'].join('\n');
  fleet.install([fleet.agent('bgwait', { state: 'working', screen: wait })]);

  /* CONTROL, and it is the whole point of the row: the same harness DOES record an
     OK for an ordinary working pane, so a null here is this gate firing rather
     than the fixture failing to register at all. */
  assert.equal((observed.read('bgwait') || {}).outcome, undefined,
    'a pane merely waiting on a background agent recorded a witnessed request: '
    + JSON.stringify(observed.all()));
});

test('an IMPOSTOR pane (a stranger under a name) records NOTHING, even scraping a 401', () => {
  // A bare session running Claude is still an agent on the board, but it is NOT tied
  // to the name, so it must never attribute an outcome to that name's account.
  fleet.install([fleet.stranger('stranger', { state: 'auth_failed' })]);
  assert.equal(observed.read('stranger'), null,
    'an untied impostor pane tainted a name it does not own: ' + JSON.stringify(observed.all()));
});

test('a CODEX agent records NOTHING even while WORKING -- the store is Claude-only', () => {
  // A codex/OpenAI agent also classifies WORKING, and one on the default codex home
  // has configDir=null, which accountForAgent maps to the DEFAULT CLAUDE account. Left
  // ungated, a working codex agent would green a Claude account it has nothing to do
  // with -- the cross-provider false-green this feature removes. The pane really is in
  // the would-record WORKING state; the runner gate is what blocks the write.
  const board = fleet.install([fleet.agent('codexer', { runner: 'codex', state: 'working' })]);
  assert.equal(board.card('codexer').state, 'working', 'fixture is not in the would-record state, so the assertion below is vacuous');
  assert.equal(observed.read('codexer'), null,
    'a working codex agent tainted a Claude account badge: ' + JSON.stringify(observed.all()));
});

test('a fresh SELF-REPORTED working (a claim, not witnessed) does NOT record ok -- green needs a WITNESSED scrape', () => {
  // reconcile turns a fresh self-report of "working" into status.state === WORKING even
  // when the SCRAPE is idle (status.js:4229). That claim can sit over a checkLive===none,
  // so recording ok from it would paint green over a hard negative. OK must come ONLY
  // from the witnessed scrape, so this self-reported-but-idle-scraped pane records nothing.
  selfreport.record('claimer', { state: 'working', because: 'mid task' });
  status.setPaneSource(() => fleet.line({ session: 'claimer-discord', command: fleet.CLAUDE_COMMAND }));
  status.setPaneCapture(() => fleet.SCREEN.idle); // the SCRAPE is idle, not working
  const board = status.snapshot();
  const card = board.agents.find((a) => a.sessionName === 'claimer');
  assert.equal(card && card.state, 'working',
    'the self-report did not reconcile to WORKING over the idle scrape, so the assertion below is vacuous');
  assert.equal(observed.read('claimer'), null,
    'a self-reported working (unwitnessed) painted the badge green: ' + JSON.stringify(observed.all()));
});

test('an IDLE tick does not clobber a prior real observation', () => {
  observed.saw('worka', observed.OUTCOME.OK, Date.now() - 1000);
  fleet.install([fleet.agent('worka', { state: 'idle' })]);
  assert.equal((observed.read('worka') || {}).outcome, observed.OUTCOME.OK,
    'an idle tick wiped a prior observed ok: ' + JSON.stringify(observed.all()));
});

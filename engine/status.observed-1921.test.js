'use strict';

/*
 * kosmos#1921 -- snapshot() records the LAST OBSERVED real-call outcome per agent
 * (engine/observed), from status.state (POST-reconcile), gated on isNamedOurs so an
 * impostor pane can never attribute an outcome to a name's account. Drives the real
 * snapshot() through test-support/fleet (pane lines built from PANE_COLUMNS by name).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
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

test('an IDLE tick does not clobber a prior real observation', () => {
  observed.saw('worka', observed.OUTCOME.OK, Date.now() - 1000);
  fleet.install([fleet.agent('worka', { state: 'idle' })]);
  assert.equal((observed.read('worka') || {}).outcome, observed.OUTCOME.OK,
    'an idle tick wiped a prior observed ok: ' + JSON.stringify(observed.all()));
});

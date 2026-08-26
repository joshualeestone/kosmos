'use strict';

// ⚠️ SANDBOX FIRST, BEFORE ANY REQUIRE, and all four roots. store.js resolves
// its root at module load, and `test-support/fleet` pulls in engine/status,
// which resolves the workers root once at require time too. Same rule and same
// reason as fixture-discipline.test.js states at its own top.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-sendertoken-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');

const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const sendertoken = require('./sendertoken');

test.after(() => {
  fleet.restore();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

/**
 * ⚠️ THE ROWS COME FROM `test-support/fleet`, NEVER FROM A LITERAL. A
 * hand-written roster row can carry fields `paneRoster()` never emits, which is
 * how a display name and a needs-you count once shipped dead. The first version
 * of this file hand-built its rows and turned main red on the
 * fixture-discipline gate (#570); this is that corrected.
 *
 * ⚠️ AND AN HONEST NOTE ABOUT WHAT THAT COSTS HERE. These tests are about an
 * agent with NO pane, but `fleet` arranges agents AS PANES, because that is
 * what the board can currently contain. So the pane-less half these tests
 * really pin is that **no `from_pane` is passed and none is consulted**: the
 * sender is resolved from the token alone. The row still originates from a pane
 * fixture, because the fixture cannot express an agent without one.
 *
 * ⭐ That limitation is not a gap in the harness, it is #570's membership half
 * showing up in the test suite: `status.snapshot` builds the fleet by mapping
 * over `tmux list-panes`, so nothing in this repo can yet arrange an agent that
 * has no pane. When that lands, these rows should come from it.
 */

test('an agent resolves by the token it was handed at launch, with no pane id anywhere', () => {
  const board = fleet.install([fleet.agent('renet-windows', { state: 'idle' })]);
  try {
    const minted = sendertoken.mint('renet-windows');
    assert.equal(minted.ok, true);
    const who = sendertoken.resolve(minted.token, board.roster);
    assert.equal(who.ok, true);
    assert.equal(who.card.sessionName, 'renet-windows');
  } finally { board.restore(); }
});

test('the body still cannot name the sender: an unissued token is refused, not believed', () => {
  const board = fleet.install([fleet.agent('renet-windows', { state: 'idle' })]);
  try {
    const who = sendertoken.resolve('a'.repeat(64), board.roster);
    assert.equal(who.ok, false);
    assert.match(who.because, /could not match that to one of your agents/);
  } finally { board.restore(); }
});

test('presenting nothing fails with its own sentence, so a caller can tell it forgot the token', () => {
  const board = fleet.install([fleet.agent('renet-windows', { state: 'idle' })]);
  try {
    const who = sendertoken.resolve('', board.roster);
    assert.equal(who.ok, false);
    assert.match(who.because, /no sender token was presented/);
  } finally { board.restore(); }
});

test('the roster tie decides, not the token: an untied row cannot speak even holding a real token', () => {
  /* `fleet.stranger` is a pane whose session name is not ours -- somebody
     else's claim on the name -- which is exactly what `isNamedOurs` refuses.
     The real thing, rather than a literal asserting what I believe it looks
     like. */
  const board = fleet.install([fleet.stranger('borrowed-name')]);
  try {
    const minted = sendertoken.mint('borrowed-name');
    assert.equal(minted.ok, true);
    const who = sendertoken.resolve(minted.token, board.roster);
    assert.equal(who.ok, false);
    assert.match(who.because, /could not match that to one of your agents/);
  } finally { board.restore(); }
});

test('a revoked token stops resolving, which is how a deleted agent stops being able to speak', () => {
  const board = fleet.install([fleet.agent('going-away', { state: 'idle' })]);
  try {
    const minted = sendertoken.mint('going-away');
    assert.equal(sendertoken.resolve(minted.token, board.roster).ok, true);
    sendertoken.revoke('going-away');
    assert.equal(sendertoken.resolve(minted.token, board.roster).ok, false);
  } finally { board.restore(); }
});

test('#570: two launches of one agent BOTH resolve, and are told apart by instance', () => {
  /* The point of the change. Under #1000 the second mint invalidated the
     first, so two live runs were indistinguishable AND one of them silently
     stopped being able to speak. Both are wrong: two runs is a real situation
     and the record has to be able to show it. */
  const board = fleet.install([fleet.agent('twice', { state: 'idle' })]);
  try {
    const one = sendertoken.mint('twice');
    const two = sendertoken.mint('twice');
    assert.notEqual(one.token, two.token);
    assert.notEqual(one.instance, two.instance, 'two launches share an instance id');

    const a = sendertoken.resolve(one.token, board.roster);
    const b = sendertoken.resolve(two.token, board.roster);
    assert.equal(a.ok, true); assert.equal(b.ok, true);
    assert.equal(a.card.sessionName, b.card.sessionName, 'they are the same agent');
    assert.equal(a.instance, one.instance);
    assert.equal(b.instance, two.instance);
  } finally { board.restore(); }
});

test('#570: live() is the detection -- a second run of one agent is VISIBLE, not silent', () => {
  const board = fleet.install([fleet.agent('doubled', { state: 'idle' })]);
  try {
    assert.deepEqual(sendertoken.live('doubled'), [], 'an agent that never launched has no live run');
    const one = sendertoken.mint('doubled');
    assert.equal(sendertoken.live('doubled').length, 1);
    const two = sendertoken.mint('doubled');
    /* THIS is the line that answers the question four external checks could not
       on 2026-08-26: is more than one of this agent running right now. */
    assert.equal(sendertoken.live('doubled').length, 2, 'a second live run did not show');

    sendertoken.retire('doubled', one.instance);
    assert.deepEqual(sendertoken.live('doubled'), [two.instance], 'retiring one run took the other with it');
    assert.equal(sendertoken.resolve(one.token, board.roster).ok, false, 'a retired run can still speak');
    assert.equal(sendertoken.resolve(two.token, board.roster).ok, true, 'the surviving run was silenced');
  } finally { board.restore(); }
});

test('#570: revoke carries the guarantee mint used to -- a recreated agent inherits nothing', () => {
  /* 🛑 THE SEMANTIC THAT MOVED. #1000 relied on mint rotating. Minting now
     appends, so the creation path MUST revoke. This test is the contract. */
  const board = fleet.install([fleet.agent('recreated', { state: 'idle' })]);
  try {
    const first = sendertoken.mint('recreated');
    assert.equal(sendertoken.resolve(first.token, board.roster).ok, true);
    sendertoken.revoke('recreated');
    const second = sendertoken.mint('recreated');
    assert.equal(sendertoken.resolve(first.token, board.roster).ok, false, 'the old run kept its voice through a recreate');
    assert.equal(sendertoken.resolve(second.token, board.roster).ok, true);
  } finally { board.restore(); }
});

test('#570: a #1000 single-token file still resolves, read as the `legacy` instance', () => {
  /* Migration is silent and one-way, so an agent holding a token minted before
     this change does not go mute. `legacy` rather than null, so a reader can
     see WHAT it is instead of guessing. */
  const board = fleet.install([fleet.agent('oldshape', { state: 'idle' })]);
  try {
    fs.mkdirSync(sendertoken.DIR, { recursive: true });
    const old = 'e'.repeat(64);
    fs.writeFileSync(path.join(sendertoken.DIR, 'oldshape.json'),
      JSON.stringify({ token: old, mintedAt: '2026-08-26T20:00:00.000Z' }), { mode: 0o600 });
    const who = sendertoken.resolve(old, board.roster);
    assert.equal(who.ok, true);
    assert.equal(who.instance, 'legacy');
    assert.deepEqual(sendertoken.live('oldshape'), ['legacy']);
  } finally { board.restore(); }
});

test('#570: the live list is capped, and it is the OLDEST run that is dropped', () => {
  /* A backstop against an agent restarted in a loop, not a policy. The newest
     run is the one still speaking, so age is the right thing to drop on. */
  const board = fleet.install([fleet.agent('loopy', { state: 'idle' })]);
  try {
    const first = sendertoken.mint('loopy');
    for (let i = 0; i < sendertoken.MAX_LIVE; i++) sendertoken.mint('loopy');
    assert.equal(sendertoken.live('loopy').length, sendertoken.MAX_LIVE);
    assert.equal(sendertoken.resolve(first.token, board.roster).ok, false, 'the oldest run survived the cap');
  } finally { board.restore(); }
});

test('one agent\'s token never resolves to another, which is the impersonation a pane id allows', () => {
  const board = fleet.install([
    fleet.agent('agent-one', { state: 'idle' }),
    fleet.agent('agent-two', { state: 'idle' }),
  ]);
  try {
    const mine = sendertoken.mint('agent-one');
    const who = sendertoken.resolve(mine.token, board.roster);
    assert.equal(who.ok, true);
    assert.equal(who.card.sessionName, 'agent-one');
  } finally { board.restore(); }
});

test('a stale token whose agent is not on the roster reads exactly like one we never issued', () => {
  const board = fleet.install([fleet.agent('someone-else', { state: 'idle' })]);
  try {
    const minted = sendertoken.mint('vanished');
    const who = sendertoken.resolve(minted.token, board.roster);
    assert.equal(who.ok, false);
    /* Not "that agent is gone": that sentence would confirm the token was once
       real, which is a yes/no oracle for anything guessing. */
    assert.match(who.because, /could not match that to one of your agents/);
  } finally { board.restore(); }
});

test('the token is kept owner-only, because it is the agent\'s ability to speak as itself', () => {
  sendertoken.mint('perms-check');
  const file = path.join(sendertoken.DIR, 'perms-check.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

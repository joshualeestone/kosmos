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

/* --------------------------------------------------------------------------
   resolveName: the roster-free reading, for the caller trying to establish
   that a paneless agent exists at all (#1112 phase 1).
   -------------------------------------------------------------------------- */

test('resolveName finds the agent WITHOUT a roster -- the whole point', () => {
  const tok = sendertoken.mint('paneless-one').token;
  const got = sendertoken.resolveName(tok);
  assert.equal(got.ok, true, 'a freshly minted token did not resolve by name: ' + got.because);
  assert.equal(got.key, 'paneless-one', 'resolved to the wrong agent: ' + got.key);
});

/* 🛑 THE ARM THAT MAKES IT WORTH HAVING. `resolve` refuses this exact case,
   because the roster has no card for an agent with no pane. If both refuse,
   the heartbeat can never say "I am here" from a machine without tmux. */
test('resolve REFUSES what resolveName accepts, when there is no pane', () => {
  const tok = sendertoken.mint('paneless-two').token;
  const withRoster = sendertoken.resolve(tok, []);
  assert.equal(withRoster.ok, false, 'resolve accepted an agent that is in no roster');
  assert.equal(sendertoken.resolveName(tok).ok, true,
    'resolveName also refused; a valid token from a tmux-less machine would be unable to identify itself at all');
});

/* ⚠️ THE DISCLOSURE PROPERTY resolve() DOCUMENTS MUST SURVIVE. A distinct
   message for "issued but gone" would confirm the token was once real. */
test('every refusal reads the same, so a probe cannot confirm a token was real', () => {
  const retired = sendertoken.mint('paneless-three').token;
  sendertoken.revoke('paneless-three');
  const gone = sendertoken.resolveName(retired);
  const neverIssued = sendertoken.resolveName('0'.repeat(64));
  assert.equal(gone.ok, false);
  assert.equal(neverIssued.ok, false);
  assert.equal(gone.because, neverIssued.because,
    'a revoked token gives a different message from an unissued one, which confirms it was once real');
});

test('a revoked token cannot heartbeat: revoke still cuts an agent off on this path', () => {
  const tok = sendertoken.mint('paneless-four').token;
  assert.equal(sendertoken.resolveName(tok).ok, true, 'precondition: it resolves before revoke');
  sendertoken.revoke('paneless-four');
  assert.equal(sendertoken.resolveName(tok).ok, false,
    'a revoked token still resolves by name; revoke would no longer cut an agent off');
});

test('an empty token is refused with its own reason, not the generic one', () => {
  const r = sendertoken.resolveName('');
  assert.equal(r.ok, false);
  assert.match(r.because, /no sender token was presented/);
});

/**
 * 🛑 THE REFUSALS MUST BE INDISTINGUISHABLE, AND THAT IS A SECURITY PROPERTY.
 *
 * A caller must not be able to tell whether a token was ever real. "Never issued",
 * "issued then revoked", "issued but the roster row is gone" and "no such token here"
 * are four different internal states and one external answer.
 *
 * ⚠️ WHY THIS TEST EXISTS RATHER THAN A COMMENT. Until 2026-08-27 the property was held
 * by FOUR separate string literals that happened to match. Nothing kept them in sync,
 * and the suite would have stayed green while somebody made one of them more helpful.
 * Recorded on #1112 as resting on "a returned string I control", singular. It was four.
 * They are one constant now, and this is what keeps them one.
 */
test('every refusal that must hide whether a token was real says the SAME sentence', () => {
  const board = fleet.install([fleet.agent('renet-windows', { state: 'idle' })]);
  try {
    const minted = sendertoken.mint('renet-windows');
    assert.equal(minted.ok, true);

    // a token that was never issued: matches no file
    const never = sendertoken.resolve('b'.repeat(64), board.roster);
    // a real token whose roster row is gone: issued, then the agent left the board
    const orphaned = sendertoken.resolve(minted.token, []);

    assert.equal(never.ok, false);
    assert.equal(orphaned.ok, false);
    assert.equal(
      never.because, orphaned.because,
      'a never-issued token and a revoked one gave different answers, which discloses that the second was once real',
    );

    // the name-only path owes the same answer
    const byName = sendertoken.resolveName('c'.repeat(64));
    assert.equal(byName.ok, false);
    assert.equal(byName.because, never.because, 'resolveName drifted from resolve');
  } finally {
    fleet.restore();
  }
});

test('CONTROL: the sentence is one constant, not four literals that happen to agree', () => {
  /* Without this, the test above passes on a file with four copies, which is exactly
     the state that produced the finding. It asserts the STRUCTURE, not the behaviour:
     behaviour agreeing today is what made the fragility invisible. */
  const src = fs.readFileSync(path.join(__dirname, 'sendertoken.js'), 'utf8');
  const literal = "'we could not match that to one of your agents'";
  const copies = src.split(literal).length - 1;
  assert.equal(copies, 1, `the refusal sentence is written out ${copies} times; it must exist once, as NO_MATCH`);
  assert.ok(src.includes('const NO_MATCH ='), 'NO_MATCH is gone; the refusals are loose again');
});

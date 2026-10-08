'use strict';
/* #5154 slice C: the bounded-retry logic for a recurring terminal error (engine/stuckterminal.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const st = require('./stuckterminal');

const AUTH = st.STUCK_MS.auth_failed;
const RATE = st.STUCK_MS.rate_limited;

test('#5154-C: only auth_failed and rate_limited are terminal; transient/own-question states are not', () => {
  assert.equal(st.isTerminal('auth_failed'), true);
  assert.equal(st.isTerminal('rate_limited'), true);
  // connection_lost is transient (self-heals); needs_you is the agent's OWN question (never masked).
  for (const s of ['connection_lost', 'needs_you', 'working', 'idle', 'stopped', '', null, undefined]) {
    assert.equal(st.isTerminal(s), false, s + ' must not be bounded here');
  }
});

test('#5154-C: a terminal error UNDER its threshold is not stuck yet', () => {
  const book = new Map();
  const t0 = 1_000_000;
  let r = st.read(book, 'leo', 'auth_failed', t0);
  assert.equal(r.stuck, false, 'just entered: not stuck');
  r = st.read(book, 'leo', 'auth_failed', t0 + AUTH - 1);
  assert.equal(r.stuck, false, 'one ms before threshold: not stuck');
  assert.equal(r.state, 'auth_failed');
  assert.equal(r.sinceAt, t0, 'the anchor stays at first-seen while the error continues');
});

test('#5154-C: a terminal error AT/PAST its threshold is stuck', () => {
  const book = new Map();
  const t0 = 2_000_000;
  st.read(book, 'mia', 'auth_failed', t0);
  const r = st.read(book, 'mia', 'auth_failed', t0 + AUTH);
  assert.equal(r.stuck, true, 'at threshold: stuck');
  assert.equal(r.sinceAt, t0);
  assert.equal(r.forMs, AUTH);
});

test('#5154-C: recovery clears the anchor and never fires', () => {
  const book = new Map();
  const t0 = 3_000_000;
  st.read(book, 'ray', 'auth_failed', t0);
  const r = st.read(book, 'ray', 'working', t0 + AUTH + 1); // recovered before anyone looked again
  assert.equal(r.stuck, false, 'a recovered agent is not stuck');
  assert.equal(book.has('ray'), false, 'the anchor is cleared on recovery');
});

test('#5154-C: switching to a DIFFERENT terminal error restarts the clock (a new episode)', () => {
  const book = new Map();
  const t0 = 4_000_000;
  st.read(book, 'sam', 'auth_failed', t0);
  // 20 min later it is rate_limited instead: a different error, so re-anchored, and not yet past RATE.
  const r = st.read(book, 'sam', 'rate_limited', t0 + 20 * 60 * 1000);
  assert.equal(r.state, 'rate_limited');
  assert.equal(r.sinceAt, t0 + 20 * 60 * 1000, 'the clock restarts for the new error');
  assert.equal(r.stuck, false, '20 min of auth_failed does not count toward the rate_limited threshold');
});

test('#5154-C: the two states carry different thresholds (rate limit waits longer than an expired login)', () => {
  assert.ok(RATE > AUTH, 'a rate limit legitimately persists, so it must not fire as early as an expired login');
  const book = new Map();
  const t0 = 5_000_000;
  st.read(book, 'rl', 'rate_limited', t0);
  assert.equal(st.read(book, 'rl', 'rate_limited', t0 + AUTH).stuck, false, 'not stuck at the auth threshold');
  assert.equal(st.read(book, 'rl', 'rate_limited', t0 + RATE).stuck, true, 'stuck at its own threshold');
});

test('#5154-C: a blip out of the terminal state resets the clock (no silent carry-over)', () => {
  const book = new Map();
  const t0 = 6_000_000;
  st.read(book, 'blip', 'auth_failed', t0);
  st.read(book, 'blip', 'working', t0 + 60_000);        // recovered briefly
  const r = st.read(book, 'blip', 'auth_failed', t0 + 120_000); // failed again: fresh anchor
  assert.equal(r.sinceAt, t0 + 120_000, 're-entering the error starts a new clock, not the old one');
  assert.equal(r.stuck, false);
});

test('#5154-C: forget drops an agent, so a recreated name never inherits an old episode', () => {
  const book = new Map();
  st.read(book, 'gone', 'auth_failed', 7_000_000);
  st.forget(book, 'gone');
  assert.equal(book.has('gone'), false);
});

test('#5154-C: assess and nextAnchor are pure (null anchor is never stuck)', () => {
  assert.deepEqual(st.assess(null, 123), { stuck: false, state: null, sinceAt: null, forMs: 0 });
  assert.equal(st.nextAnchor(null, 'working', 123), null, 'a non-terminal state yields no anchor');
  assert.deepEqual(st.nextAnchor(null, 'auth_failed', 123), { state: 'auth_failed', sinceAt: 123 });
});

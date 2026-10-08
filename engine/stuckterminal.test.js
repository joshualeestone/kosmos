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

// tellStuck: the once-per-episode sweep the server tick drives.
function sweepOnce(book, told, rows, now) {
  const tells = [];
  st.tellStuck({ rows, book, told, now, tell: (key, r, shown) => tells.push({ key, state: r.state, shown }) });
  return tells;
}

test('#5154-C: tellStuck tells ONCE per episode, not again while it stays stuck', () => {
  const book = new Map(); const told = new Set();
  const t0 = 10_000_000;
  const rows = [{ key: 'leo', state: 'auth_failed', shown: 'Leo' }];
  assert.deepEqual(sweepOnce(book, told, rows, t0), [], 'just entered: no tell');
  assert.deepEqual(sweepOnce(book, told, rows, t0 + AUTH - 1), [], 'under threshold: no tell');
  const first = sweepOnce(book, told, rows, t0 + AUTH);
  assert.equal(first.length, 1, 'crossed threshold: told once');
  assert.equal(first[0].shown, 'Leo');
  assert.deepEqual(sweepOnce(book, told, rows, t0 + AUTH + 60_000), [], 'still stuck: not told again');
});

test('#5154-C: tellStuck clears the told-mark on recovery and tells again on a NEW episode', () => {
  const book = new Map(); const told = new Set();
  const t0 = 11_000_000;
  const stuck = [{ key: 'mia', state: 'rate_limited', shown: 'Mia' }];
  sweepOnce(book, told, stuck, t0);
  assert.equal(sweepOnce(book, told, stuck, t0 + RATE).length, 1, 'told for the first episode');
  sweepOnce(book, told, [{ key: 'mia', state: 'working', shown: 'Mia' }], t0 + RATE + 1); // recovered
  assert.equal(told.has('mia'), false, 'told-mark cleared on recovery');
  // A fresh episode: stuck again, and past the threshold again -> told again.
  const t1 = t0 + RATE + 2;
  sweepOnce(book, told, stuck, t1);
  assert.equal(sweepOnce(book, told, stuck, t1 + RATE).length, 1, 'a new episode tells again');
});

test('#5154-C: tellStuck prunes the book and the told-set for agents no longer in the roster (lifecycle-forget)', () => {
  const book = new Map(); const told = new Set();
  const t0 = 12_000_000;
  const rows = [{ key: 'ray', state: 'auth_failed', shown: 'Ray' }];
  sweepOnce(book, told, rows, t0);
  sweepOnce(book, told, rows, t0 + AUTH); // now stuck + told
  assert.equal(book.has('ray'), true); assert.equal(told.has('ray'), true);
  sweepOnce(book, told, [], t0 + AUTH + 1); // Ray removed from the roster
  assert.equal(book.has('ray'), false, 'a gone agent is pruned from the book');
  assert.equal(told.has('ray'), false, 'and from the told-set');
});

test('#5154-C: tellStuck never tells a non-terminal agent (precedence: its own needs_you is not masked)', () => {
  const book = new Map(); const told = new Set();
  const t0 = 13_000_000;
  // An agent in its OWN needs_you is not a terminal error here, so it is never told about + anchors nothing.
  const rows = [{ key: 'q', state: 'needs_you', shown: 'Q' }];
  assert.deepEqual(sweepOnce(book, told, rows, t0), []);
  assert.deepEqual(sweepOnce(book, told, rows, t0 + 10 * RATE), [], 'however long it sits in needs_you, never told');
  assert.equal(book.has('q'), false, 'no anchor for a non-terminal state');
});

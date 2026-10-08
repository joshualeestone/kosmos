'use strict';
/* #5154 slice C: the bounded-retry logic for a recurring terminal error (engine/stuckterminal.js).
 * The anchor is on disk (store.ROOT/stuck) so forget is reachable from create/remove/delete-leftover;
 * the sandbox below points store.ROOT at a temp dir, as crashloop-5154.test.js does.
 *
 *   node --test engine/stuckterminal.test.js
 */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-stuckterminal-5154-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const test = require('node:test');
const assert = require('node:assert/strict');
const st = require('./stuckterminal');
const store = require('./store');

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const AUTH = st.STUCK_MS.auth_failed;
const RATE = st.STUCK_MS.rate_limited;

test('sandbox: the store root is the temp dir', () => {
  assert.equal(path.resolve(store.ROOT), path.resolve(SANDBOX, 'Kosmos'));
});

// ---- pure functions ----

test('#5154-C: only auth_failed and rate_limited are terminal; transient/own-question states are not', () => {
  assert.equal(st.isTerminal('auth_failed'), true);
  assert.equal(st.isTerminal('rate_limited'), true);
  for (const s of ['connection_lost', 'needs_you', 'working', 'idle', 'stopped', '', null, undefined]) {
    assert.equal(st.isTerminal(s), false, s + ' must not be bounded here');
  }
});

test('#5154-C: nextAnchor/assess are pure', () => {
  assert.equal(st.nextAnchor(null, 'working', 123), null, 'a non-terminal state yields no anchor');
  assert.deepEqual(st.nextAnchor(null, 'auth_failed', 123), { state: 'auth_failed', sinceAt: 123 });
  const a = { state: 'auth_failed', sinceAt: 100 };
  assert.equal(st.nextAnchor(a, 'auth_failed', 999), a, 'the same terminal state keeps the same anchor (clock runs)');
  assert.deepEqual(st.nextAnchor(a, 'rate_limited', 999), { state: 'rate_limited', sinceAt: 999 }, 'a switch restarts the clock');
  assert.deepEqual(st.assess(null, 123), { stuck: false, state: null, sinceAt: null, forMs: 0 });
  assert.equal(st.assess({ state: 'auth_failed', sinceAt: 0 }, AUTH).stuck, true, 'at threshold is stuck');
  assert.equal(st.assess({ state: 'auth_failed', sinceAt: 0 }, AUTH - 1).stuck, false, 'one ms before is not');
});

// ---- disk read / peek / forget ----

test('#5154-C: read advances the on-disk clock while stuck, and peek reads it without advancing', () => {
  const k = 'leo'; const t0 = 1_000_000;
  assert.equal(st.read(k, 'auth_failed', t0).stuck, false, 'just entered: not stuck');
  assert.equal(st.read(k, 'auth_failed', t0 + AUTH - 1).stuck, false, 'under threshold: not stuck');
  assert.equal(st.read(k, 'auth_failed', t0 + AUTH).stuck, true, 'at threshold: stuck');
  // peek sees the same anchor (sinceAt stayed t0) without moving it.
  const p = st.peek(k, 'auth_failed', t0 + AUTH + 60_000);
  assert.equal(p.stuck, true); assert.equal(p.sinceAt, t0, 'the anchor stayed at first-seen');
  assert.equal(st.readAnchor(k).sinceAt, t0, 'persisted on disk');
});

test('#5154-C review 4 (W2): peek returns not-stuck unless the anchor matches the CURRENT state', () => {
  const k = 'switch'; const t0 = 20_000_000;
  st.read(k, 'rate_limited', t0);
  // 40m later the anchor would be "stuck" on rate_limited, but the agent is NOW auth_failed (a switch
  // between sweeps). peek(auth_failed) must NOT report the stale rate_limited stuck state.
  const p = st.peek(k, 'auth_failed', t0 + RATE);
  assert.deepEqual(p, { stuck: false, state: null, sinceAt: null, forMs: 0 }, 'no stale state on a mid-sweep switch');
  assert.equal(st.peek(k, 'rate_limited', t0 + RATE).stuck, true, 'peek still reports it for the matching state');
  assert.equal(st.peek(k, 'working', t0 + RATE).stuck, false, 'and not for a non-terminal state');
});

test('#5154-C review 4 (W3): clearAll wipes every anchor (a restart re-anchors from the live state)', () => {
  st.read('ca1', 'auth_failed', 21_000_000);
  st.read('ca2', 'rate_limited', 21_000_000);
  assert.ok(st.keys().length >= 2);
  st.clearAll();
  assert.deepEqual(st.keys(), [], 'all anchors gone after clearAll');
});

test('#5154-C review 4 (W1): tellStuck prunes the TOLD mark of a departed agent, so a return re-pushes', () => {
  const told = new Set(); const t0 = 22_000_000;
  const rows = [{ key: 'tp', state: 'auth_failed', shown: 'T' }];
  sweepOnce(told, rows, t0);
  sweepOnce(told, rows, t0 + AUTH);   // now stuck + told
  assert.ok(told.has('tp'), 'told while stuck');
  sweepOnce(told, [{ key: 'z', state: 'working', shown: 'Z' }], t0 + AUTH + 1);   // tp left the roster (good roster)
  assert.equal(told.has('tp'), false, 'told-mark pruned when the agent left');
});

test('#5154-C: recovery clears the on-disk anchor and never fires again', () => {
  const k = 'ray'; const t0 = 2_000_000;
  st.read(k, 'auth_failed', t0);
  const r = st.read(k, 'working', t0 + AUTH + 1); // recovered
  assert.equal(r.stuck, false);
  assert.equal(st.readAnchor(k), null, 'the anchor file is removed on recovery');
});

test('#5154-C: switching to a DIFFERENT terminal error restarts the clock (a new episode)', () => {
  const k = 'sam'; const t0 = 3_000_000;
  st.read(k, 'auth_failed', t0);
  const r = st.read(k, 'rate_limited', t0 + 20 * 60 * 1000); // different error 20m later
  assert.equal(r.state, 'rate_limited');
  assert.equal(r.sinceAt, t0 + 20 * 60 * 1000, 'the clock restarts for the new error');
  assert.equal(r.stuck, false, '20m of auth_failed does not count toward the rate_limited threshold');
});

test('#5154-C: the two states carry different thresholds (rate limit waits longer than an expired login)', () => {
  assert.ok(RATE > AUTH, 'a rate limit legitimately persists, so it must not fire as early as an expired login');
  const k = 'rl'; const t0 = 4_000_000;
  st.read(k, 'rate_limited', t0);
  assert.equal(st.read(k, 'rate_limited', t0 + AUTH).stuck, false, 'not stuck at the auth threshold');
  assert.equal(st.read(k, 'rate_limited', t0 + RATE).stuck, true, 'stuck at its own threshold');
});

test('#5154-C: forget drops the anchor, so a recreated agent of the same name starts a FRESH clock (W2)', () => {
  const k = 'gone'; const t0 = 5_000_000;
  st.read(k, 'auth_failed', t0);
  assert.equal(st.read(k, 'auth_failed', t0 + AUTH).stuck, true, 'the first agent is stuck');
  st.forget(k); // the agent is removed (create/remove/delete-leftover call this)
  assert.equal(st.readAnchor(k), null, 'forget removed the anchor');
  // A new agent of the same name, in the same terminal state, 1ms later: it must NOT inherit the old clock.
  const r = st.read(k, 'auth_failed', t0 + AUTH + 1);
  assert.equal(r.stuck, false, 'the recreated agent starts fresh, not stuck on the removed agent\'s clock');
  assert.equal(r.sinceAt, t0 + AUTH + 1, 'the clock is anchored to the recreate, not the removed agent');
});

// ---- tellStuck (the once-per-episode sweep) ----

function sweepOnce(told, rows, now) {
  const tells = [];
  st.tellStuck({ rows, told, now, tell: (key, r, shown) => tells.push({ key, state: r.state, shown }) });
  return tells;
}

test('#5154-C: tellStuck tells ONCE per episode, not again while it stays stuck', () => {
  const told = new Set(); const t0 = 10_000_000;
  const rows = [{ key: 'tsa', state: 'auth_failed', shown: 'Leo' }];
  assert.deepEqual(sweepOnce(told, rows, t0), [], 'just entered: no tell');
  assert.deepEqual(sweepOnce(told, rows, t0 + AUTH - 1), [], 'under threshold: no tell');
  const first = sweepOnce(told, rows, t0 + AUTH);
  assert.equal(first.length, 1, 'crossed threshold: told once');
  assert.equal(first[0].shown, 'Leo');
  assert.deepEqual(sweepOnce(told, rows, t0 + AUTH + 60_000), [], 'still stuck: not told again');
});

test('#5154-C: tellStuck clears the told-mark on recovery and tells again on a NEW episode', () => {
  const told = new Set(); const t0 = 11_000_000;
  const stuck = [{ key: 'tsr', state: 'rate_limited', shown: 'Mia' }];
  sweepOnce(told, stuck, t0);
  assert.equal(sweepOnce(told, stuck, t0 + RATE).length, 1, 'told for the first episode');
  sweepOnce(told, [{ key: 'tsr', state: 'working', shown: 'Mia' }], t0 + RATE + 1); // recovered
  assert.equal(told.has('tsr'), false, 'told-mark cleared on recovery');
  const t1 = t0 + RATE + 2;
  sweepOnce(told, stuck, t1);
  assert.equal(sweepOnce(told, stuck, t1 + RATE).length, 1, 'a new episode tells again');
});

test('#5154-C: tellStuck never tells a non-terminal agent (precedence: its own needs_you is not masked)', () => {
  const told = new Set(); const t0 = 13_000_000;
  const rows = [{ key: 'tsq', state: 'needs_you', shown: 'Q' }];
  assert.deepEqual(sweepOnce(told, rows, t0), []);
  assert.deepEqual(sweepOnce(told, rows, t0 + 10 * RATE), [], 'however long it sits in needs_you, never told');
  assert.equal(st.readAnchor('tsq'), null, 'no anchor for a non-terminal state');
});

test('#5154-C: readAnchor rejects a malformed or wrong-typed file (reads as no anchor, never throws)', () => {
  const k = 'bad';
  fs.mkdirSync(st.dir(), { recursive: true });
  for (const body of ['not json', '{"state":"working","sinceAt":1}', '{"state":"auth_failed"}', '{"state":"auth_failed","sinceAt":"soon"}', '{}', 'null']) {
    fs.writeFileSync(st.fileFor(k), body);
    assert.equal(st.readAnchor(k), null, 'rejects: ' + body);
  }
  fs.writeFileSync(st.fileFor(k), '{"state":"auth_failed","sinceAt":123}');
  assert.deepEqual(st.readAnchor(k), { state: 'auth_failed', sinceAt: 123 }, 'a well-formed anchor reads back');
});

test('#5154-C review 2: tellStuck prunes the anchor of an agent that LEFT the roster (off-roster, good roster)', () => {
  const told = new Set(); const t0 = 14_000_000;
  const present = [{ key: 'leaver', state: 'auth_failed', shown: 'Z' }];
  sweepOnce(told, present, t0);
  assert.ok(st.readAnchor('leaver'), 'anchored while present');
  // Next sweep: the agent is gone from the (good, non-empty) roster -> its anchor is forgotten.
  sweepOnce(told, [{ key: 'other', state: 'working', shown: 'O' }], t0 + 60_000);
  assert.equal(st.readAnchor('leaver'), null, 'a departed agent\'s anchor is pruned on a good roster');
  // So if it returns later in the same terminal state, it starts a FRESH clock (not stuck immediately).
  const r = st.read('leaver', 'auth_failed', t0 + 120_000);
  assert.equal(r.stuck, false);
  assert.equal(r.sinceAt, t0 + 120_000, 'returned agent re-anchors to now, not the old clock');
});

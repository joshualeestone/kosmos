'use strict';

/* #7212 slice 3: a stuck Claude agent whose own account was signed out says so, from at most one live check per stall
   and per hour (engine/stallsignin.js). */

const test = require('node:test');
const assert = require('node:assert/strict');
const stallsignin = require('./stallsignin');
const ds = require('./deliverystreak');
const { STATE } = require('./subscription');

const T0 = Date.parse('2026-10-27T12:00:00Z');
const STALL = { since: '2026-10-27T11:20:00.000Z', count: 4, lastWhy: 'unconfirmed', words: ds.WHY_WORDS.unconfirmed, next: ds.NEXT_WORDS.unconfirmed };
const card = (extra = {}) => ({ sessionName: 'ada', runner: '', account: { dir: '/x/.claude-b', isDefault: false }, deliveryStall: STALL, ...extra });
const settle = () => new Promise((resolve) => setImmediate(resolve));

function counting(answer) {
  const calls = [];
  stallsignin.setCheckerForTests((account) => { calls.push(account); return typeof answer === 'function' ? answer(calls.length) : answer; });
  return calls;
}

test.beforeEach(() => stallsignin.resetForTests());
test.after(() => stallsignin.resetForTests());

test('a signed-out account names the cause once its check has answered', async () => {
  const calls = counting(STATE.NONE);
  assert.equal(stallsignin.overlay(card(), T0).deliveryStall.words, ds.WHY_WORDS.unconfirmed, 'the first read must not wait on a live check');
  await settle();
  const out = stallsignin.overlay(card(), T0 + 1000);
  assert.equal(out.deliveryStall.words, 'Its Claude account is signed out');
  assert.equal(out.deliveryStall.next, 'Sign in again in Settings, AI Models');
  assert.equal(out.deliveryStall.since, STALL.since, 'the stall itself is kept');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], card().account, 'the agent\'s own account is the one checked');
});

test('CONTROL: a connected or unreachable account keeps slice 2\'s reason', async () => {
  for (const state of [STATE.CONNECTED, STATE.UNKNOWN, null]) {
    stallsignin.resetForTests();
    counting(state);
    stallsignin.overlay(card(), T0);
    await settle();
    assert.equal(stallsignin.overlay(card(), T0 + 1000).deliveryStall.words, ds.WHY_WORDS.unconfirmed, String(state));
  }
});

test('one live check per stall and per hour, and a new stall checks at once', async () => {
  const calls = counting(STATE.CONNECTED);
  stallsignin.overlay(card(), T0);
  await settle();
  for (let i = 1; i <= 20; i += 1) stallsignin.overlay(card(), T0 + i * 5000);   // the status tick
  assert.equal(calls.length, 1, 'the tick ran a live check each time');
  stallsignin.overlay(card(), T0 + stallsignin.CHECK_EVERY_MS);
  assert.equal(calls.length, 2, 'an hour on, the stall is checked again');
  await settle();
  stallsignin.overlay(card({ deliveryStall: { ...STALL, since: '2026-10-27T13:30:00.000Z' } }), T0 + stallsignin.CHECK_EVERY_MS + 1000);
  assert.equal(calls.length, 3, 'a new stall is checked without waiting out the hour');
});

test('a check still running is not started twice, however long it takes', async () => {
  let release;
  const calls = counting(() => new Promise((resolve) => { release = resolve; }));
  stallsignin.overlay(card(), T0);
  stallsignin.overlay(card(), T0 + stallsignin.CHECK_EVERY_MS + 1);
  assert.equal(calls.length, 1);
  release(STATE.NONE);
  await settle(); await settle();
  assert.equal(stallsignin.overlay(card(), T0 + stallsignin.CHECK_EVERY_MS + 2).deliveryStall.signedOut, true);
});

test('an unreachable answer after a signed-out one keeps it; a connected one clears it', async () => {
  counting((n) => (n === 1 ? STATE.NONE : n === 2 ? STATE.UNKNOWN : STATE.CONNECTED));
  stallsignin.overlay(card(), T0); await settle();
  stallsignin.overlay(card(), T0 + stallsignin.CHECK_EVERY_MS); await settle();
  assert.equal(stallsignin.overlay(card(), T0 + stallsignin.CHECK_EVERY_MS + 1).deliveryStall.signedOut, true, 'could-not-check undid a real answer');
  stallsignin.overlay(card(), T0 + 2 * stallsignin.CHECK_EVERY_MS); await settle();
  assert.equal(stallsignin.overlay(card(), T0 + 2 * stallsignin.CHECK_EVERY_MS + 1).deliveryStall.signedOut, undefined, 'signing in again did not clear it');
});

test('nothing is checked for a card that is not stuck, not Claude, or not on a Claude account', async () => {
  const calls = counting(STATE.NONE);
  for (const c of [card({ deliveryStall: null }), card({ runner: 'codex' }), card({ runner: 'gemini' }), card({ account: null }),
    card({ account: { dir: '/x/.deepseek', isDefault: false, provider: 'deepseek' } })]) {
    assert.equal(stallsignin.overlay(c, T0), c);
  }
  await settle();
  assert.equal(calls.length, 0);
  stallsignin.overlay(card({ runner: 'claude' }), T0);
  assert.equal(calls.length, 1, 'CONTROL: a card whose runner says claude is checked');
});

test('a checker that throws or rejects leaves the card as it is', async () => {
  stallsignin.setCheckerForTests(() => { throw new Error('boom'); });
  assert.equal(stallsignin.overlay(card(), T0).deliveryStall.words, ds.WHY_WORDS.unconfirmed);
  stallsignin.resetForTests();
  stallsignin.setCheckerForTests(() => Promise.reject(new Error('boom')));
  stallsignin.overlay(card(), T0); await settle();
  assert.equal(stallsignin.overlay(card(), T0 + 1).deliveryStall.words, ds.WHY_WORDS.unconfirmed);
});

test('sweep forgets agents no longer stuck, so their next stall checks again', async () => {
  const calls = counting(STATE.CONNECTED);
  stallsignin.overlay(card(), T0); await settle();
  stallsignin.sweep(['someone-else']);
  stallsignin.overlay(card(), T0 + 1000);
  assert.equal(calls.length, 2);
});

test('the status route applies the overlay to every card it returns, and the minute sweep forgets agents no longer stuck', () => {
  /* A source check, as slice 2's page check is (engine/heldwarn2-7212.test.js): the route runs in a board process that a
     stall cannot be planted in from here. */
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
  const map = src.indexOf('const agents = snap.agents.filter((a) => !gone.has(a.sessionName)).map(');
  const hook = src.indexOf("agents[i] = require('./engine/stallsignin').overlay(agents[i]);", map);
  assert.ok(map > 0 && hook > map, 'the status route no longer overlays its cards');
  assert.ok(hook - map < 20000, 'the overlay moved away from the status route\'s cards');
  assert.ok(src.includes("require('./engine/stallsignin').sweep(shown);"), 'the minute sweep no longer forgets agents');
});

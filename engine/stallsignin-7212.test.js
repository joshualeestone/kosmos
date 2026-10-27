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

/* Review 1: the seam is the account list and the live call, so which row a card is matched to is tested too. */
const ROWS = [{ dir: '/x/.claude', isDefault: true }, { dir: '/x/.claude-b', isDefault: false }, { dir: '/x/.claude-k', isDefault: false, apiKey: true }];
function counting(answer, rows = ROWS) {
  const calls = [];
  stallsignin.setDepsForTests({
    list: () => rows,
    checkRow: (row) => {
      calls.push(row);
      const a = typeof answer === 'function' ? answer(calls.length, row) : answer;
      return Promise.resolve(a).then((state) => ({ ...row, connection: { state } }));
    },
  });
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
  assert.equal(calls[0].dir, '/x/.claude-b', 'the agent\'s own account is the one checked');
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
  stallsignin.setDepsForTests({ list: () => ROWS, checkRow: () => { throw new Error('boom'); } });
  assert.equal(stallsignin.overlay(card(), T0).deliveryStall.words, ds.WHY_WORDS.unconfirmed);
  stallsignin.resetForTests();
  stallsignin.setDepsForTests({ list: () => ROWS, checkRow: () => Promise.reject(new Error('boom')) });
  stallsignin.overlay(card(), T0); await settle();
  assert.equal(stallsignin.overlay(card(), T0 + 1).deliveryStall.words, ds.WHY_WORDS.unconfirmed);
});

test('sweep forgets agents no longer stuck, so their next stall checks again', async () => {
  const calls = counting(STATE.CONNECTED);
  stallsignin.overlay(card(), T0); await settle();
  stallsignin.sweep(['someone-else'], T0 + 60000);
  stallsignin.overlay(card({ deliveryStall: null }), T0 + 61000);
  stallsignin.overlay(card(), T0 + 120000);
  assert.equal(calls.length, 1, 'review 1: leaving the stall for a minute and coming back started a second check');
  stallsignin.sweep(['someone-else'], T0 + stallsignin.CHECK_EVERY_MS);
  stallsignin.overlay(card({ deliveryStall: { ...STALL, since: STALL.since } }), T0 + stallsignin.CHECK_EVERY_MS + 1);
  assert.equal(calls.length, 2, 'an hour on, a forgotten agent is checked again');
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

test('review 1: each card is checked on its own row: the default, a second account, a key; no row, no check', async () => {
  const calls = counting(STATE.CONNECTED);
  stallsignin.overlay(card({ sessionName: 'dflt', account: { dir: '/x/.claude', isDefault: true } }), T0);
  stallsignin.overlay(card({ sessionName: 'second' }), T0);
  stallsignin.overlay(card({ sessionName: 'gone', account: { dir: '/x/.claude-gone', isDefault: false } }), T0);
  await settle(); await settle();
  assert.deepEqual(calls.map((r) => r.dir), ['/x/.claude', '/x/.claude-b'], 'a card was checked on another account\'s row');
});

test('review 1: a refused key says to replace the key, not to sign in', async () => {
  counting(STATE.NONE);
  const k = card({ account: { dir: '/x/.claude-k', isDefault: false } });
  stallsignin.overlay(k, T0); await settle(); await settle();
  const out = stallsignin.overlay(k, T0 + 1);
  assert.equal(out.deliveryStall.words, 'Its Claude key no longer works');
  assert.equal(out.deliveryStall.next, 'Replace its key in Settings, AI Models');
});

test('review 1: signing in again (the accounts screen sees it connected) clears the card at once', async () => {
  counting(STATE.NONE);
  stallsignin.overlay(card(), T0); await settle(); await settle();
  assert.equal(stallsignin.overlay(card(), T0 + 1).deliveryStall.signedOut, true);
  stallsignin.heard({ dir: '/x/.claude-other', isDefault: false }, STATE.CONNECTED);
  assert.equal(stallsignin.overlay(card(), T0 + 2).deliveryStall.signedOut, true, 'CONTROL: another account connecting changes nothing');
  stallsignin.heard({ dir: '/x/.claude-b', isDefault: false }, STATE.UNKNOWN);
  assert.equal(stallsignin.overlay(card(), T0 + 3).deliveryStall.signedOut, true, 'CONTROL: an unknown answer changes nothing');
  stallsignin.heard({ dir: '/x/.claude-b', isDefault: false }, STATE.CONNECTED);
  assert.equal(stallsignin.overlay(card(), T0 + 4).deliveryStall.signedOut, undefined, 'the card still says sign in again after a sign-in');
});

test('review 1: accounts.checkRowLive tells stallsignin what it saw', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'accounts.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function checkRowLive'));
  assert.ok(/require\('\.\/stallsignin'\)\.heard\(row, connection && connection\.state\)/.test(fn.slice(0, fn.indexOf('\n}\n'))), 'checkRowLive no longer reports a connected row');
});

test('review 1: an account list that throws clears running, so the stall is checked again an hour on', async () => {
  let n = 0;
  stallsignin.setDepsForTests({ list: () => { n += 1; if (n === 1) throw new Error('unreadable'); return ROWS; }, checkRow: (row) => ({ ...row, connection: { state: STATE.NONE } }) });
  stallsignin.overlay(card(), T0); await settle(); await settle();
  stallsignin.overlay(card(), T0 + stallsignin.CHECK_EVERY_MS); await settle(); await settle();
  assert.equal(n, 2, 'a throw before the check left it running forever');
  assert.equal(stallsignin.overlay(card(), T0 + stallsignin.CHECK_EVERY_MS + 1).deliveryStall.signedOut, true);
});

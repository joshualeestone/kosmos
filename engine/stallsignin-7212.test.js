'use strict';

/* #7212 slice 3: a stuck Claude agent whose own account was signed out says so, from at most one live check of that
   account per hour (engine/stallsignin.js), read as the AI Models badge reads it (observed.verdict). */

const os = require('node:os');
const path = require('node:path');
const SANDBOX = path.join(os.tmpdir(), 'kosmos-stallsignin-test-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const test = require('node:test');
const assert = require('node:assert/strict');
const stallsignin = require('./stallsignin');
const ds = require('./deliverystreak');
const sub = require('./subscription');
const { STATE } = sub;
const observed = require('./observed');
const accounts = require('./accounts');

const T0 = Date.parse('2026-10-27T12:00:00Z');
const STALL = { since: '2026-10-27T11:20:00.000Z', count: 4, lastWhy: 'unconfirmed', words: ds.WHY_WORDS.unconfirmed, next: ds.NEXT_WORDS.unconfirmed };
/* A real card from test-support/fleet (fixture discipline), copied, with the fields this slice reads. */
const fleet = require('../test-support/fleet');
const realCards = new Map();
function realCard(name) {
  if (!realCards.has(name)) {
    const board = fleet.install([fleet.agent(name, { state: 'idle' })]);
    try { realCards.set(name, { ...board.agents[0] }); } finally { board.restore(); }
  }
  return realCards.get(name);
}
const card = (extra = {}, name = 'ada') => ({ ...realCard(name), runner: '', account: { dir: '/x/.claude-b', isDefault: false }, deliveryStall: STALL, ...extra });
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

test.beforeEach(() => { stallsignin.resetForTests(); observed._clearForTest(); sub.setRunner(null); });
test.after(() => { stallsignin.resetForTests(); try { require('node:fs').rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

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

test('review 5: the live state is the latest answer, as the badge reads it: an unknown one is unknown', async () => {
  counting((n) => (n === 1 ? STATE.NONE : n === 2 ? STATE.UNKNOWN : STATE.CONNECTED));
  stallsignin.overlay(card(), T0); await settle();
  stallsignin.overlay(card(), T0 + stallsignin.CHECK_EVERY_MS); await settle();
  assert.equal(stallsignin.overlay(card(), T0 + stallsignin.CHECK_EVERY_MS + 1).deliveryStall.signedOut, undefined, 'an old "none" outlived a check that could not tell (the badge says unchecked)');
  stallsignin.overlay(card(), T0 + 2 * stallsignin.CHECK_EVERY_MS); await settle();
  assert.equal(stallsignin.overlay(card(), T0 + 2 * stallsignin.CHECK_EVERY_MS + 1).deliveryStall.signedOut, undefined);
  stallsignin.resetForTests(); counting(STATE.NONE);
  stallsignin.overlay(card(), T0); await settle();
  assert.equal(stallsignin.overlay(card(), T0 + 1).deliveryStall.signedOut, true, 'CONTROL: a "none" answer is signed out');
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


test('the status route applies the overlay to every card it returns, and the minute sweep forgets agents no longer stuck', () => {
  /* A source check, as slice 2's page check is (engine/heldwarn2-7212.test.js): the route runs in a board process that a
     stall cannot be planted in from here. */
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
  const map = src.indexOf('const agents = snap.agents.filter((a) => !gone.has(a.sessionName)).map(');
  const hook = src.indexOf("agents[i] = require('./engine/stallsignin').overlay(agents[i], undefined, { obsFor });", map);
  assert.ok(map > 0 && hook > map, 'the status route no longer overlays its cards');
  assert.ok(hook - map < 20000, 'the overlay moved away from the status route\'s cards');
  assert.ok(src.includes("require('./engine/stallsignin').sweep();"), 'the minute sweep no longer forgets accounts');
});

test('review 1: each card is checked on its own row: the default, a second account, a key; no row, no check', async () => {
  const calls = counting(STATE.CONNECTED);
  stallsignin.overlay(card({ account: { dir: '/x/.claude', isDefault: true } }, 'dflt'), T0);
  stallsignin.overlay(card({}, 'second'), T0);
  stallsignin.overlay(card({ account: { dir: '/x/.claude-gone', isDefault: false } }, 'gone'), T0);
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
  stallsignin.heard({ dir: '/x/.claude-b', isDefault: false }, STATE.CONNECTED);
  assert.equal(stallsignin.overlay(card(), T0 + 4).deliveryStall.signedOut, undefined, 'the card still says sign in again after a sign-in');
});


test('review 1: an account list that throws clears running, so the stall is checked again an hour on', async () => {
  let n = 0;
  stallsignin.setDepsForTests({ list: () => { n += 1; if (n === 1) throw new Error('unreadable'); return ROWS; }, checkRow: (row) => ({ ...row, connection: { state: STATE.NONE } }) });
  stallsignin.overlay(card(), T0); await settle(); await settle();
  stallsignin.overlay(card(), T0 + stallsignin.CHECK_EVERY_MS); await settle(); await settle();
  assert.equal(n, 2, 'a throw before the check left it running forever');
  assert.equal(stallsignin.overlay(card(), T0 + stallsignin.CHECK_EVERY_MS + 1).deliveryStall.signedOut, true);
});

/* Review 2: the record is the account's. */
test('one live check per account and hour, however many agents on it are stuck, and whatever stalls they start', async () => {
  const calls = counting(STATE.CONNECTED);
  for (const n of ['a1', 'a2', 'a3', 'a4', 'a5']) stallsignin.overlay(card({}, n), T0);
  assert.equal(calls.length, 1, 'five stuck agents on one account started five checks');
  await settle();
  for (let i = 1; i <= 20; i += 1) stallsignin.overlay(card({}, 'a1'), T0 + i * 5000);   // the status tick
  stallsignin.overlay(card({ deliveryStall: { ...STALL, since: '2026-10-27T12:30:00.000Z' } }, 'a1'), T0 + 200000);
  assert.equal(calls.length, 1, 'the tick, or a new stall within the hour, ran another check');
  stallsignin.overlay(card({}, 'a2'), T0 + stallsignin.CHECK_EVERY_MS);
  assert.equal(calls.length, 2, 'an hour on, the account is checked again');
  stallsignin.overlay(card({ account: { dir: '/x/.claude', isDefault: true } }, 'b1'), T0 + 1);
  assert.equal(calls.length, 3, 'CONTROL: an agent on another account has its own check');
});

test('review 2: an agent moved to another account reads that account, not its old verdict', async () => {
  counting((n, row) => (row.dir === '/x/.claude-b' ? STATE.NONE : STATE.CONNECTED));
  stallsignin.overlay(card(), T0); await settle();
  assert.equal(stallsignin.overlay(card(), T0 + 1).deliveryStall.signedOut, true);
  const moved = card({ account: { dir: '/x/.claude', isDefault: true } });
  stallsignin.overlay(moved, T0 + 2); await settle();
  assert.equal(stallsignin.overlay(moved, T0 + 3).deliveryStall.signedOut, undefined, 'the old account\'s "signed out" followed the agent');
});

test('review 2: a slow "signed out" that started before a connected answer was heard is ignored', async () => {
  let release;
  counting(() => new Promise((resolve) => { release = resolve; }));
  stallsignin.overlay(card(), T0);
  stallsignin.heard({ dir: '/x/.claude-b', isDefault: false }, STATE.CONNECTED, T0 + 3000);   // the person signed in meanwhile
  release(STATE.NONE); await settle(); await settle();
  assert.equal(stallsignin.overlay(card(), T0 + 8000).deliveryStall.signedOut, undefined, 'a stale signed-out answer won');
});


test('review 2: the sweep forgets an account no stuck card has read for an hour, never one still being checked', async () => {
  let release;
  const calls = counting(() => new Promise((resolve) => { release = resolve; }));
  stallsignin.overlay(card(), T0);
  stallsignin.sweep(T0 + 2 * stallsignin.CHECK_EVERY_MS);
  release(STATE.CONNECTED); await settle(); await settle();
  stallsignin.overlay(card(), T0 + 2 * stallsignin.CHECK_EVERY_MS + 1);
  assert.equal(calls.length, 2, 'the hour passed, so the account is checked again');
  release(STATE.CONNECTED); await settle(); await settle();
  stallsignin.sweep(T0 + 2 * stallsignin.CHECK_EVERY_MS + 1000);
  stallsignin.overlay(card(), T0 + 2 * stallsignin.CHECK_EVERY_MS + 2000);
  assert.equal(calls.length, 2, 'a sweep within the hour of a read dropped the record');
  stallsignin.sweep(T0 + 4 * stallsignin.CHECK_EVERY_MS);
  stallsignin.overlay(card(), T0 + 4 * stallsignin.CHECK_EVERY_MS + 1);
  assert.equal(calls.length, 3);
});

/* Review 3. */

test('review 3: a refused key is cleared only by the reader that tries the key', async () => {
  counting(STATE.NONE);
  const k = card({ account: { dir: '/x/.claude-k', isDefault: false } });
  stallsignin.overlay(k, T0); await settle(); await settle();
  stallsignin.heard({ dir: '/x/.claude-k' }, STATE.CONNECTED, T0 + 1);
  assert.equal(stallsignin.overlay(k, T0 + 2).deliveryStall.signedOut, true, 'auth status cleared a key it never tried');
  stallsignin.heard({ dir: '/x/.claude-k' }, STATE.CONNECTED, T0 + 3, { fromRow: true });
  assert.equal(stallsignin.overlay(k, T0 + 4).deliveryStall.signedOut, undefined);
});

test('review 3: subscription.checkLive clears only the account it checked, default included', async () => {
  counting(STATE.NONE);
  const T = Date.now() - 1000;   // review 4: checkLive stamps real time, so this test runs on it
  const dflt = card({ account: { dir: '/x/.claude', isDefault: true } }, 'd');
  stallsignin.overlay(card(), T); stallsignin.overlay(dflt, T); await settle(); await settle();
  assert.equal(stallsignin.overlay(card(), T + 1).deliveryStall.signedOut, true);
  assert.equal(stallsignin.overlay(dflt, T + 1).deliveryStall.signedOut, true);
  sub.setRunner(async () => ({ stdout: JSON.stringify({ loggedIn: true, subscriptionType: 'max' }), err: null }));
  await sub.checkLive({ configDir: '/x/.claude-b' });
  assert.equal(stallsignin.overlay(card(), Date.now()).deliveryStall.signedOut, undefined, 'the checked folder was not cleared');
  assert.equal(stallsignin.overlay(dflt, Date.now()).deliveryStall.signedOut, true, 'a folder\'s check cleared the default account');
  await sub.checkLive();
  assert.equal(stallsignin.overlay(dflt, Date.now()).deliveryStall.signedOut, undefined, 'the default account\'s check did not clear it');
});

test('review 3: accounts.checkRowLive tells stallsignin, as the reader that tried the row', async () => {
  counting(STATE.NONE);
  stallsignin.overlay(card(), Date.now() - 1000); await settle(); await settle();
  sub.setRunner(async () => ({ stdout: JSON.stringify({ loggedIn: true, subscriptionType: 'max' }), err: null }));
  stallsignin.setDepsForTests(null);
  const r = await accounts.checkRowLive({ dir: '/x/.claude-b', isDefault: false });
  assert.equal(r.connection.state, STATE.CONNECTED);
  stallsignin.setDepsForTests({ list: () => ROWS, checkRow: () => new Promise(() => {}) });
  assert.equal(stallsignin.overlay(card(), Date.now()).deliveryStall.signedOut, undefined);
});


/* Review 5: the card reads the badge's own evidence (server.js claudeObservationsFor, handed in as obsFor). */
const evidence = (map) => (dir) => ({ obs: map[dir] || null, checkObs: null });
test('review 5: a sibling agent\'s fresh 401 on the account is "signed out" though auth status says logged in (#874)', async () => {
  counting(STATE.CONNECTED);
  stallsignin.overlay(card(), T0); await settle();
  const refused = evidence({ '/x/.claude-b': { outcome: observed.OUTCOME.REJECTED, at: T0 + 1000 } });
  assert.equal(stallsignin.overlay(card(), T0 + 2000, { obsFor: refused }).deliveryStall.words, 'Its Claude account is signed out', 'an expiry-blind logged-in hid a refused account');
  assert.equal(stallsignin.overlay(card(), T0 + 2000 + observed.freshMs() + 1, { obsFor: refused }).deliveryStall.signedOut, undefined, 'CONTROL: a stale 401 decides nothing');
  assert.equal(stallsignin.overlay(card(), T0 + 2000).deliveryStall.signedOut, undefined, 'CONTROL: with no evidence, the live check decides');
});
test('review 5: a sibling\'s fresh good request is not "signed out", whatever the live check says (credentials gone, token held)', async () => {
  counting(STATE.NONE);
  stallsignin.overlay(card(), T0); await settle();
  const working = evidence({ '/x/.claude-b': { outcome: observed.OUTCOME.OK, at: T0 + 1000 } });
  assert.equal(stallsignin.overlay(card(), T0 + 2000, { obsFor: working }).deliveryStall.signedOut, undefined, 'the card said signed out while the badge says working');
  assert.equal(stallsignin.overlay(card(), T0 + 2000).deliveryStall.signedOut, true, 'CONTROL: without the good request, "none" is signed out');
});
test('review 5: a Check now 401 survives an expiry-blind connected answer, as on the badge', async () => {
  counting(STATE.CONNECTED);
  stallsignin.overlay(card(), T0); await settle();
  observed.sawDir(observed.PROVIDER.ANTHROPIC, '/x/.claude-b', observed.OUTCOME.REJECTED, T0 + 1000);
  stallsignin.heard({ dir: '/x/.claude-b', isDefault: false }, STATE.CONNECTED, T0 + 2000, { fromRow: true });   // the accounts screen repaints
  assert.equal(stallsignin.overlay(card(), T0 + 3000).deliveryStall.signedOut, true, 'a blind connected erased the real 401');
});
test('review 5: the default account named by its folder is the default account', async () => {
  counting(STATE.NONE);
  const dflt = card({ account: { dir: '/x/.claude', isDefault: true } }, 'd');
  stallsignin.overlay(dflt, T0); await settle();
  assert.equal(stallsignin.overlay(dflt, T0 + 1).deliveryStall.signedOut, true);
  stallsignin.heard({ dir: require('node:path').join(accounts.homeDir(), '.claude'), isDefault: false }, STATE.CONNECTED, T0 + 2);
  assert.equal(stallsignin.overlay(dflt, T0 + 3).deliveryStall.signedOut, undefined, 'a connected answer for the default folder missed the default account');
});

/* Review 6: another caller's answer, whichever it is, is the account's latest. */
test('review 6: a "none" the AI Models screen saw reaches the stuck card at once; an unknown one is unknown', async () => {
  counting(STATE.CONNECTED);
  stallsignin.overlay(card(), T0); await settle();
  assert.equal(stallsignin.overlay(card(), T0 + 1).deliveryStall.signedOut, undefined, 'control: connected at first');
  stallsignin.heard({ dir: '/x/.claude-b', isDefault: false }, STATE.NONE, T0 + 2);
  assert.equal(stallsignin.overlay(card(), T0 + 3).deliveryStall.signedOut, true, 'the screen showed signed out and the card did not');
  stallsignin.heard({ dir: '/x/.claude-b', isDefault: false }, STATE.UNKNOWN, T0 + 4);
  assert.equal(stallsignin.overlay(card(), T0 + 5).deliveryStall.signedOut, undefined, 'an unknown answer kept an old "none" (the badge says unchecked)');
});
test('review 6: a check that started before another caller\'s answer does not overwrite it, either way', async () => {
  let release;
  counting(() => new Promise((resolve) => { release = resolve; }));
  stallsignin.overlay(card(), T0);
  stallsignin.heard({ dir: '/x/.claude-b', isDefault: false }, STATE.NONE, T0 + 1000);
  release(STATE.CONNECTED); await settle(); await settle();
  assert.equal(stallsignin.overlay(card(), T0 + 2000).deliveryStall.signedOut, true, 'an older connected overwrote a newer none');
});

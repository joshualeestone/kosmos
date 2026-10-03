'use strict';
/* #3997 (ruling C): the login-date reader's own rules. */
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('./claudeloginlive');

test.afterEach(() => { m.setReaderForTests(null); m._clearForTest(); });

test('#3997: loginGood only for an unverified, signed-in row whose date is ahead and has no rejection on record', () => {
  const now = 1000;
  const good = { badge: 'signed_in_unverified', checkLiveState: 'connected', latestOutcome: null, until: 2000, now };
  assert.equal(m.loginGood(good), true);
  assert.equal(m.loginGood({ ...good, until: 999 }), false, 'a login that has run out');
  assert.equal(m.loginGood({ ...good, until: null }), false, 'no date read');
  assert.equal(m.loginGood({ ...good, latestOutcome: '401' }), false, 'a rejection on record');
  assert.equal(m.loginGood({ ...good, badge: 'working' }), false, 'already green from a real outcome');
  assert.equal(m.loginGood({ ...good, badge: 'rejected' }), false);
  assert.equal(m.loginGood({ ...good, checkLiveState: 'none' }), false, 'claude auth status says signed out');
});

test('#3997 ruling A: the switch is on, and greenFromLogin follows loginGood exactly', () => {
  assert.equal(m.GREEN_FROM_LOGIN, true);
  const good = { badge: 'signed_in_unverified', checkLiveState: 'connected', until: Date.now() + 1e9 };
  assert.equal(m.greenFromLogin(good), true);
  // Every way loginGood says no, greenFromLogin says no too: a real failure is never painted green.
  assert.equal(m.greenFromLogin({ ...good, until: 999 }), false, 'an expired login');
  assert.equal(m.greenFromLogin({ ...good, until: null }), false, 'no date read');
  assert.equal(m.greenFromLogin({ ...good, latestOutcome: '401' }), false, 'a rejection on record');
  assert.equal(m.greenFromLogin({ ...good, checkLiveState: 'none' }), false, 'signed out');
});

test('#3997: validUntil skips a key account, maps the default to an unset CLAUDE_CONFIG_DIR, and caches', async () => {
  const asked = [];
  m.setReaderForTests((ccd) => { asked.push(ccd); return 5000; });
  assert.equal(await m.validUntil({ apiKey: true, dir: '/k' }, 100), null, 'a key account has its own live check');
  assert.equal(await m.validUntil({ isDefault: true, dir: '/home/.claude' }, 100), 5000);
  assert.equal(await m.validUntil({ dir: '/home/.claude-aria' }, 100), 5000);
  assert.deepEqual(asked, [undefined, '/home/.claude-aria']);
  await m.validUntil({ dir: '/home/.claude-aria' }, 100 + m.CACHE_MS - 1);
  assert.equal(asked.length, 2, 'a second read inside the cache window asked again');
  await m.validUntil({ dir: '/home/.claude-aria' }, 100 + m.CACHE_MS);
  assert.equal(asked.length, 3, 'a read after the cache window did not ask again');
});

test('#3997: a reader that throws or answers nonsense gives no date, never a throw', async () => {
  m.setReaderForTests(() => { throw new Error('keychain locked'); });
  assert.equal(await m.validUntil({ dir: '/a' }, 1), null);
  m._clearForTest();
  m.setReaderForTests(() => 'soon');
  assert.equal(await m.validUntil({ dir: '/a' }, 1), null);
});

test('#3997 review 1: the route waits for a slow read only within its budget, and the answer is there on the next poll', async () => {
  let release;
  m.setReaderForTests(() => new Promise((ok) => { release = () => ok(7000); }));
  assert.equal(await m.validUntilWithin({ dir: '/slow' }, 20, 100), null, 'a slow read held the route past its budget');
  release();
  await new Promise((r) => setImmediate(r));
  assert.equal(await m.validUntilWithin({ dir: '/slow' }, 20, 100), 7000, 'the finished read was not kept for the next poll');
});

test('#3997 review 1: concurrent requests share one read', async () => {
  let calls = 0;
  m.setReaderForTests(() => { calls += 1; return new Promise((ok) => setTimeout(() => ok(9000), 10)); });
  const [a, b] = await Promise.all([m.validUntil({ dir: '/same' }, 1), m.validUntil({ dir: '/same' }, 1)]);
  assert.deepEqual([a, b, calls], [9000, 9000, 1]);
});

test('#3997 review 1: no answer is kept longer than an answer, so a missing entry is not asked every minute', async () => {
  let calls = 0;
  m.setReaderForTests(() => { calls += 1; return null; });
  await m.validUntil({ dir: '/none' }, 0);
  await m.validUntil({ dir: '/none' }, m.CACHE_MS + 1);
  assert.equal(calls, 1, 'a miss was asked again after the answer window');
  await m.validUntil({ dir: '/none' }, m.MISS_CACHE_MS);
  assert.equal(calls, 2, 'a miss was never asked again');
});

test('#3997 review 1: a refused Check now blocks the login-green for that folder until a later connected or rejected answer', () => {
  m._clearForTest();
  const good = { badge: 'signed_in_unverified', checkLiveState: 'connected', until: Date.now() + 1e9 };
  assert.equal(m.loginGood({ ...good, checkRefused: m.checkRefused('/a') }), true, 'premise: green before any check');
  m.noteCheck('/a', { state: 'unknown', refused: true });
  assert.equal(m.checkRefused('/a'), true);
  assert.equal(m.loginGood({ ...good, checkRefused: m.checkRefused('/a') }), false, 'a refused check left the login good');
  assert.equal(m.checkRefused('/b'), false, 'the mark is per folder');
  m.noteCheck('/a', { state: 'unknown', refused: false });   // capacity or no answer: changes nothing
  assert.equal(m.checkRefused('/a'), true);
  m.noteCheck('/a', { state: 'connected' });
  assert.equal(m.checkRefused('/a'), false, 'a later connected answer did not clear it');
  m.noteCheck('/a', { state: 'unknown', refused: true });
  m.noteCheck('/a', { state: 'none' });
  assert.equal(m.checkRefused('/a'), false, 'a later rejected answer did not clear it (the rejection itself blocks green)');
  m.noteCheck('', { state: 'unknown', refused: true });
  assert.equal(m.checkRefused(''), false, 'an empty folder is never marked');
});

test('#3997 review 3: a real outcome seen after the failed check outranks it (a working account is not held amber)', () => {
  m._clearForTest();
  m.noteCheck('/a', { state: 'unknown', refused: true }, 1000);
  assert.equal(m.checkRefused('/a'), true, 'no outcome at all: the failed check stands');
  assert.equal(m.checkRefused('/a', 900), true, 'an outcome from BEFORE the failed check does not lift it');
  assert.equal(m.checkRefused('/a', 1000), true, 'the same moment does not lift it');
  assert.equal(m.checkRefused('/a', 1001), false, 'an outcome AFTER the failed check lifts it');
  assert.equal(m.checkRefused('/a', null), true);
});

/* #5168 (after #5164, measured on account-e 2026-10-03): a login past its date whose access token still works says when
   its agents stop; every other state says nothing. */
test('#5168: worksUntil is the access token\'s time only for an ended login with a live token; control arms', async () => {
  const now = 10_000_000;
  const row = { dir: '/x/.claude-account-e' };
  const read = async (until, works) => { m._clearForTest(); m.setReaderForTests(() => ({ until, works })); await m.validUntil(row, now); return m.worksUntil(row, now); };
  assert.equal(await read(now - 1000, now + 5000), now + 5000, 'an ended login with a live token did not say when it stops');
  assert.equal(await read(now - 1000, now - 1), null, 'a run-out token still said working');
  assert.equal(await read(now - 1000, 0), null, 'the 0 a failed refresh writes read as working');
  assert.equal(await read(now + 1000, now + 5000), null, 'a login not yet ended carried a stop time');
  assert.equal(await read(now - 1000, null), null, 'no access date');
  // A plain number reader (every #3997 test) still works, and gives no stop time.
  m._clearForTest(); m.setReaderForTests(() => now + 1000);
  assert.equal(await m.validUntil(row, now), now + 1000);
  assert.equal(m.worksUntil(row, now), null);
  // Nothing read yet, a key account, a non-default row with no folder: null, and no read of its own.
  m._clearForTest(); let asked = 0; m.setReaderForTests(() => { asked += 1; return { until: now - 1, works: now + 1 }; });
  assert.equal(m.worksUntil(row, now), null);
  assert.equal(m.worksUntil({ apiKey: true, dir: '/x' }, now), null);
  assert.equal(m.worksUntil({ dir: '' }, now), null);
  assert.equal(asked, 0, 'worksUntil read the keychain itself');
});

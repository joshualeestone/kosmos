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

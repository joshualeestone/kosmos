'use strict';
/* kosmos#6178: the weekly facts per Claude account, shared by /api/accounts and /api/status. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const aw = require('./accountsweekly');
const statusline = require('./kosmos-statusline');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-accountsweekly-')));
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
const FUTURE = Math.floor(Date.now() / 1000) + 3 * 86400;
function acct(name, pct) {
  const d = path.join(SANDBOX, name);
  fs.mkdirSync(d, { recursive: true });
  if (pct !== undefined) fs.writeFileSync(path.join(d, statusline.FILE), JSON.stringify({ usedPct: pct, resetsAt: FUTURE, at: Date.now() }));
  return d;
}

test('#6178 summary: one entry per Claude account, with its reading; an API key is listed with no reading', () => {
  aw.resetForTests();
  const a = acct('a', 40);
  const b = acct('b');
  const out = aw.summary([
    { dir: a, email: 'a@example.com', label: 'A', isDefault: true },
    { dir: b, email: 'b@example.com', label: 'B' },
    { dir: acct('k'), email: null, apiKey: true },
  ], Date.now());
  assert.equal(out.length, 3, 'an account was dropped: ' + JSON.stringify(out));
  assert.deepEqual([out[2].apiKey, out[2].weekly, out[2].blocked], [true, null, null], 'an API-key account was given a reading or a reason');
  assert.equal(out[0].apiKey, false);
  assert.equal(out[0].dir, a);
  assert.equal(out[0].email, 'a@example.com');
  assert.equal(out[0].isDefault, true);
  assert.equal(out[0].weekly.usedPct, 40);
  assert.equal(out[0].weekly.resetsAt, FUTURE * 1000, 'resetsAt is not in ms');
  assert.equal(out[1].weekly, null, 'an account with no reading was given one');
  assert.equal(out[1].blocked, aw.weeklyBlockedOf({ dir: b }), 'the summary\'s reason is not the helper\'s');   // weeklyBlockedOf's own test pins each reason
});

test('#6178 summary is kept for CACHE_MS, and an account change does not wait for it', () => {
  aw.resetForTests();
  const a = acct('c', 10);
  const now = Date.now();
  const list = [{ dir: a, email: 'c@example.com' }];
  assert.equal(aw.summary(list, now)[0].weekly.usedPct, 10);
  fs.writeFileSync(path.join(a, statusline.FILE), JSON.stringify({ usedPct: 55, resetsAt: FUTURE, at: now }));
  assert.equal(aw.summary(list, now + 1000)[0].weekly.usedPct, 10, 'the 5 s poll re-read the reading inside the cache window');
  assert.equal(aw.summary(list, now + aw.CACHE_MS + 1)[0].weekly.usedPct, 55, 'a reading older than the cache was kept');
  const two = list.concat([{ dir: acct('d'), email: 'd@example.com' }]);
  assert.equal(aw.summary(two, now + aw.CACHE_MS + 2).length, 2, 'an added account waited for the cache to run out');
});

test('#6178 weeklyBlockedOf names why there can be no reading', () => {
  const d = acct('e');
  assert.equal(aw.weeklyBlockedOf({ dir: d }), 'not-wired');
  fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'mine' } }));
  assert.equal(aw.weeklyBlockedOf({ dir: d }), 'own-statusline');
  fs.writeFileSync(path.join(d, 'settings.json'), '{not json');
  assert.equal(aw.weeklyBlockedOf({ dir: d }), 'unreadable-settings');
  assert.equal(aw.weeklyBlockedOf({ dir: d, apiKey: true }), null, 'a key account was given a reason');
});

test('#6178 an account that becomes an API key says so at once, not after the cache', () => {
  aw.resetForTests();
  const d = acct('f', 20);
  const now = Date.now();
  assert.equal(aw.summary([{ dir: d, email: 'f@example.com' }], now).length, 1);
  const after = aw.summary([{ dir: d, email: 'f@example.com', apiKey: true }], now + 1000);
  assert.deepEqual([after[0].apiKey, after[0].weekly], [true, null], 'the old reading was kept inside the cache window');
});

test('#6176 fiveHourOf: the reading in ms for an account, nothing for a key even with a file there', () => {
  const d = acct('five-6176');
  const soon = Math.floor(Date.now() / 1000) + 2 * 3600, at = Date.now() - 60e3;
  fs.writeFileSync(path.join(d, statusline.FIVE_HOUR_FILE), JSON.stringify({ usedPct: 64, resetsAt: soon, at }));
  assert.deepEqual(aw.fiveHourOf({ dir: d }, Date.now()), { usedPct: 64, resetsAt: soon * 1000, at });
  assert.equal(aw.fiveHourOf({ dir: d, apiKey: true }, Date.now()), null, 'a key has no five-hour limit');
  assert.equal(aw.fiveHourOf({ dir: path.join(SANDBOX, 'none-6176') }, Date.now()), null);
  assert.equal(aw.fiveHourOf(null, Date.now()), null);
});

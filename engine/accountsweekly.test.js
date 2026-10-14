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

test('#6178 summary: one entry per Claude account, with its reading; an API key is left out', () => {
  aw.resetForTests();
  const a = acct('a', 40);
  const b = acct('b');
  const out = aw.summary([
    { dir: a, email: 'a@example.com', label: 'A', isDefault: true },
    { dir: b, email: 'b@example.com', label: 'B' },
    { dir: acct('k'), email: null, apiKey: true },
  ], Date.now());
  assert.equal(out.length, 2, 'an API-key account was sent: ' + JSON.stringify(out));
  assert.equal(out[0].dir, a);
  assert.equal(out[0].email, 'a@example.com');
  assert.equal(out[0].isDefault, true);
  assert.equal(out[0].weekly.usedPct, 40);
  assert.equal(out[0].weekly.resetsAt, FUTURE * 1000, 'resetsAt is not in ms');
  assert.equal(out[1].weekly, null, 'an account with no reading was given one');
  assert.equal(out[1].blocked, process.platform === 'win32' ? 'windows' : 'not-wired', 'no settings file: nothing records a reading');
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
  assert.equal(aw.weeklyBlockedOf({ dir: d }, 'darwin'), 'not-wired');
  assert.equal(aw.weeklyBlockedOf({ dir: d }, 'win32'), 'windows');
  fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'mine' } }));
  assert.equal(aw.weeklyBlockedOf({ dir: d }, 'darwin'), 'own-statusline');
  fs.writeFileSync(path.join(d, 'settings.json'), '{not json');
  assert.equal(aw.weeklyBlockedOf({ dir: d }, 'darwin'), 'unreadable-settings');
  assert.equal(aw.weeklyBlockedOf({ dir: d, apiKey: true }, 'darwin'), null, 'a key account was given a reason');
});

test('#6178 an account that becomes an API key leaves the summary at once, not after the cache', () => {
  aw.resetForTests();
  const d = acct('f', 20);
  const now = Date.now();
  assert.equal(aw.summary([{ dir: d, email: 'f@example.com' }], now).length, 1);
  assert.equal(aw.summary([{ dir: d, email: 'f@example.com', apiKey: true }], now + 1000).length, 0, 'a key account stayed listed inside the cache window');
});

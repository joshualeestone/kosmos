'use strict';

/**
 * Federation Kosmos+ gate, producer side: remote.kosmosPlus() (engine).
 *
 *   node --test engine/remote-kosmosplus.test.js
 *
 * The board's /api/status surfaces `kosmos_plus` (bool) from this, which the web
 * fed gate reads. The one property that makes it a paid-feature gate and not a
 * leak: it is true ONLY when the cached coordinator standing is exactly "good".
 * Everything else -- unknown, empty, a near-miss, an unreadable file -- is false.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fedgate-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const remote = require('../engine/remote');

function writeSettings(obj) {
  fs.mkdirSync(path.dirname(remote.FILE), { recursive: true });
  fs.writeFileSync(remote.FILE, JSON.stringify(obj) + '\n');
}

test('kosmosPlus: false when there is no settings file (fail-safe: unknown is not a member)', () => {
  try { fs.rmSync(remote.FILE, { force: true }); } catch { /* ignore */ }
  assert.equal(remote.kosmosPlus(), false);
});

test('kosmosPlus: true ONLY for the exact standing "good"', () => {
  writeSettings({ on: true, standing: 'good' });
  assert.equal(remote.kosmosPlus(), true, 'standing "good" -> member');
  // Every near-miss and non-member value fails toward false -- no paid UI leak.
  for (const s of ['', 'lapsed', 'trial', 'suspended', 'good ', ' good', 'Good', 'GOOD', 'goodish']) {
    writeSettings({ on: true, standing: s });
    assert.equal(remote.kosmosPlus(), false, JSON.stringify(s) + ' -> NOT a member (fail-safe)');
  }
});

test('kosmosPlus: false when standing is absent or a non-string (fail-safe)', () => {
  writeSettings({ on: true });                       // no standing key
  assert.equal(remote.kosmosPlus(), false, 'absent standing -> not a member');
  writeSettings({ on: true, standing: 42 });          // wrong type
  assert.equal(remote.kosmosPlus(), false, 'non-string standing -> not a member');
});

test('kosmosPlus: false when the settings file is corrupt (read() ok:false)', () => {
  fs.mkdirSync(path.dirname(remote.FILE), { recursive: true });
  fs.writeFileSync(remote.FILE, '{ this is not json');
  assert.equal(remote.kosmosPlus(), false, 'unreadable settings -> not a member (never throws, never true)');
});

test('standing survives an unrelated write() (the cache is not dropped)', () => {
  writeSettings({ on: true, standing: 'good', relay: 'host:9' });
  // setOn does write({...read(), on}) -- it reconstructs the file from read(), so a
  // field read() does not carry would be lost. This proves read() carries standing.
  remote.setOn(false);
  assert.equal(remote.read().standing, 'good', 'standing persisted through the write');
  assert.equal(remote.kosmosPlus(), true, 'and kosmosPlus still sees it');
});

test('forget() CLEARS the standing -- the account-switch leak (a gone account is not a member)', async () => {
  writeSettings({ on: true, standing: 'good' });
  assert.equal(remote.kosmosPlus(), true, 'precondition: a member');
  // Not enrolled in this sandbox, so forget() skips the coordinator retire and just
  // wipes local state + rewrites settings. The point under test: it must not leave a
  // "good" standing behind for the next (unknown) account.
  await remote.forget();
  assert.equal(remote.read().standing, '', 'forget cleared the cached standing');
  assert.equal(remote.kosmosPlus(), false, 'a forgotten account is NOT a member (no leak to the next sign-in)');
});

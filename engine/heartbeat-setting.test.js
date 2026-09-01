'use strict';
/* #1722: the persisted on/off + interval for the product heartbeat. Off by
 * default, a closed set of interval choices, validation refuses a nonsense
 * period. Sandboxed data root before the require, exactly as notify.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-heartbeat-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const hb = require('./heartbeat-setting');

test.afterEach(() => {
  fs.rmSync(hb.FILE, { force: true });
});

test('defaults: off, interval 17 (the fleet reference cadence), and a clean read', () => {
  const s = hb.read();
  assert.equal(s.on, false);
  assert.equal(s.intervalMinutes, 17);
  assert.equal(s.ok, true);
});

test('setOn persists and is read back', () => {
  assert.equal(hb.setOn(true).ok, true);
  assert.equal(hb.read().on, true);
  assert.equal(hb.setOn(false).ok, true);
  assert.equal(hb.read().on, false);
});

test('setOn refuses a non-boolean', () => {
  const r = hb.setOn('yes');
  assert.equal(r.ok, false);
  assert.ok(r.because);
});

test('setInterval accepts every choice in the closed set and refuses others', () => {
  for (const m of hb.INTERVAL_CHOICES) {
    assert.equal(hb.setInterval(m).ok, true, `${m} should be accepted`);
    assert.equal(hb.read().intervalMinutes, m);
  }
  const bad = hb.setInterval(7);
  assert.equal(bad.ok, false, '7 is not a choice');
  assert.ok(bad.because);
  // the refused write did not change the stored value
  assert.equal(hb.read().intervalMinutes, hb.INTERVAL_CHOICES[hb.INTERVAL_CHOICES.length - 1]);
});

test('setInterval refuses a string that looks numeric', () => {
  assert.equal(hb.setInterval('17').ok, false);
});

test('on and interval persist independently (a patch does not reset the sibling)', () => {
  hb.setInterval(60);
  hb.setOn(true);
  const s = hb.read();
  assert.equal(s.on, true);
  assert.equal(s.intervalMinutes, 60);
});

test('a stored interval outside the closed set falls back to the default on read', () => {
  fs.writeFileSync(hb.FILE, JSON.stringify({ on: true, intervalMinutes: 999 }) + '\n');
  const s = hb.read();
  assert.equal(s.on, true, 'the valid half is kept');
  assert.equal(s.intervalMinutes, 17, 'the nonsense interval falls back, never drives the runner');
});

test('a corrupt file reads as safe defaults with ok:false', () => {
  fs.writeFileSync(hb.FILE, 'not json');
  const s = hb.read();
  assert.equal(s.on, false);
  assert.equal(s.intervalMinutes, 17);
  assert.equal(s.ok, false);
});

test('intervalMs reflects the stored minutes', () => {
  hb.setInterval(5);
  assert.equal(hb.intervalMs(), 5 * 60 * 1000);
  hb.setInterval(60);
  assert.equal(hb.intervalMs(), 60 * 60 * 1000);
});

'use strict';
/* #1722: the persisted on/off + interval for the product heartbeat. On by
 * default (#2013), a closed set of interval choices, validation refuses a nonsense
 * period. Sandboxed data root before the require, exactly as notify.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-heartbeat-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const hb = require('./heartbeat-setting');

// #1856: hb.FILE now lives under the AgentWorkforce leaf (store.ROOT), and afterEach
// removes only the file, not the dir -- so ensure the dir before each test. Without
// this the tests that write hb.FILE DIRECTLY (below) only passed because an earlier
// test's write() had created the leaf dir first: green in the full run, ENOENT in
// isolation. This makes each test self-contained, like the ping/engmode/limits fixes.
test.beforeEach(() => {
  fs.mkdirSync(nodePath.dirname(hb.FILE), { recursive: true });
});

test.afterEach(() => {
  fs.rmSync(hb.FILE, { force: true });
});

test('defaults: ON (Josh 2026-09-03), interval 17 (the fleet reference cadence), and a clean read', () => {
  const s = hb.read();
  assert.equal(s.on, true, 'an absent store is never-configured, which is on by default');
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
    assert.equal(hb.setIntervalMinutes(m).ok, true, `${m} should be accepted`);
    assert.equal(hb.read().intervalMinutes, m);
  }
  const bad = hb.setIntervalMinutes(7);
  assert.equal(bad.ok, false, '7 is not a choice');
  assert.ok(bad.because);
  // the refused write did not change the stored value
  assert.equal(hb.read().intervalMinutes, hb.INTERVAL_CHOICES[hb.INTERVAL_CHOICES.length - 1]);
});

test('setInterval refuses a string that looks numeric', () => {
  assert.equal(hb.setIntervalMinutes('17').ok, false);
});

test('on and interval persist independently (a patch does not reset the sibling)', () => {
  hb.setIntervalMinutes(60);
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

test('a JSON ARRAY is corrupt too, and falls to safe-OFF, not the ON default (#2013)', () => {
  /* 🛑 THE FAIL-SAFE HOLE. `typeof [] === 'object'`, so an array passed the bare
     object guard; `[].on` is then undefined and the ON-by-default rule turned a
     corrupt config INTO phoning home -- the exact direction the corrupt path must
     never take. A JSON scalar (string/number) already fell to off via the typeof
     check; the array was the one corrupt shape that slipped through. */
  fs.writeFileSync(hb.FILE, JSON.stringify([1, 2, 3]));
  const s = hb.read();
  assert.equal(s.on, false, 'a corrupt array config must fall to OFF, never inherit the ON default');
  assert.equal(s.ok, false, 'a corrupt array must report ok:false');
  /* CONTROL: a real object still reads ON, so the assertion above is
     discriminating rather than turning every read off. */
  fs.writeFileSync(hb.FILE, JSON.stringify({ on: true }));
  assert.equal(hb.read().on, true, 'the control: a genuine object is not treated as corrupt');
});

test('a corrupt NON-OBJECT JSON value (scalar or null) also falls to safe-OFF (#2013)', () => {
  /* The guard has three legs -- !parsed (null/falsy), typeof !== object (a
     scalar), Array.isArray (an array). The array leg is pinned above; this pins
     the other corrupt shapes so a future edit to ANY leg cannot silently regress
     one back to the ON default. Each payload is a VALID JSON value, so it reaches
     the typeof guard rather than the parse-failure catch. */
  for (const payload of ['null', '42', '"hello"', 'true', 'false', '0', '""']) {
    fs.writeFileSync(hb.FILE, payload);
    const s = hb.read();
    assert.equal(s.on, false, `a JSON ${payload} must fall to OFF, never the ON default`);
    assert.equal(s.ok, false, `a JSON ${payload} must report ok:false`);
  }
});

test('set validates BOTH fields before writing either (atomic)', () => {
  hb.set({ on: false, intervalMinutes: 10 }); // baseline
  const bad = hb.set({ on: true, intervalMinutes: 7 }); // valid on + invalid interval
  assert.equal(bad.ok, false);
  assert.ok(bad.because);
  const s = hb.read();
  assert.equal(s.on, false, 'the valid on was NOT persisted alongside the rejected interval');
  assert.equal(s.intervalMinutes, 10, 'the interval is unchanged');
  // a fully-valid patch writes both
  assert.equal(hb.set({ on: true, intervalMinutes: 60 }).ok, true);
  const s2 = hb.read();
  assert.equal(s2.on, true);
  assert.equal(s2.intervalMinutes, 60);
});

test('set leaves an omitted field untouched', () => {
  hb.set({ on: true, intervalMinutes: 5 });
  hb.set({ intervalMinutes: 17 }); // no `on` in the patch
  const s = hb.read();
  assert.equal(s.on, true, 'on is preserved when the patch omits it');
  assert.equal(s.intervalMinutes, 17);
});


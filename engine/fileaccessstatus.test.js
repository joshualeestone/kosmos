'use strict';
/**
 * fileaccessstatus: the engine's read side of the native file-access verdict
 * (Screen 2, Access, gated-Next). The load-bearing property is the SAME
 * THREE-answers discipline as a11ystatus: "the app says NOT granted" must be
 * distinguishable from "we cannot check at all", because the gate blocks only on
 * the FORMER and must never false-block a browser (the latter) nor let a UI
 * claim a state nobody measured.
 *
 *   node --test engine/fileaccessstatus.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fileaccess-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const fa = require('./fileaccessstatus');

function write(obj) {
  fs.mkdirSync(path.dirname(fa.FILE), { recursive: true });
  fs.writeFileSync(fa.FILE, JSON.stringify(obj));
}
function clear() { try { fs.rmSync(fa.FILE, { force: true }); } catch { /* */ } }

test('no file at all -> checkable:false (a browser / not-yet-checked), NOT granted:false', () => {
  clear();
  const r = fa.read();
  assert.equal(r.checkable, false);
  assert.equal(r.granted, undefined, 'must not claim a granted verdict when nothing was measured');
});

test('a fresh granted verdict -> checkable:true, granted:true', () => {
  write({ granted: true, at: new Date().toISOString() });
  const r = fa.read();
  assert.equal(r.checkable, true);
  assert.equal(r.granted, true);
});

test('a fresh NOT-granted verdict -> checkable:true, granted:false (the only state that gates)', () => {
  write({ granted: false, at: new Date().toISOString() });
  const r = fa.read();
  assert.equal(r.checkable, true);
  assert.equal(r.granted, false);
});

test('THE DISCRIMINATOR: not-granted and uncheckable are different answers', () => {
  write({ granted: false, at: new Date().toISOString() });
  const gated = fa.read();
  clear();
  const uncheckable = fa.read();
  // The gate blocks on `gated` (checkable && !granted) and NOT on `uncheckable`.
  assert.equal(gated.checkable && gated.granted === false, true, 'this one gates');
  assert.equal(uncheckable.checkable, false, 'this one does NOT gate (fail-safe)');
});

test('a stale verdict falls back to uncheckable (the app is not maintaining it)', () => {
  write({ granted: true, at: new Date(Date.now() - (fa.STALE_AFTER_MS + 1000)).toISOString() });
  const r = fa.read();
  assert.equal(r.checkable, false, 'a days-old reading must not gate on or vouch for anything');
});

test('a malformed verdict (no boolean granted) -> uncheckable, never a throw', () => {
  write({ granted: 'yes', at: new Date().toISOString() });
  assert.equal(fa.read().checkable, false);
  write({ at: new Date().toISOString() });
  assert.equal(fa.read().checkable, false);
  fs.writeFileSync(fa.FILE, 'not json');
  assert.equal(fa.read().checkable, false);
});

test('a verdict with no readable time -> uncheckable (cannot judge freshness)', () => {
  write({ granted: true, at: 'whenever' });
  assert.equal(fa.read().checkable, false);
});

/* #3213: an aged verdict is stale only because the app writes on-demand (the probe
   IS the macOS prompt, permflood-2125), not because the app is gone. While the app
   process is up (nativePresent) the last-known verdict is HELD so the S2 Access pill
   can keep showing "granted" without any new probe. It only ever extends an EXISTING
   valid reading -- never manufactures one (Angel's caveat a). */
test('#3213: a stale verdict is HELD while nativePresent -> checkable:true, real verdict, honest at, and the SAME input expires without a live app', () => {
  const agedAt = new Date(Date.now() - (fa.STALE_AFTER_MS + 1000)).toISOString();
  write({ granted: true, at: agedAt });
  const held = fa.read({ nativePresent: true });
  assert.equal(held.checkable, true, 'a live app holds the last-known verdict so the pill can keep showing granted');
  assert.equal(held.granted, true, 'the held verdict is the real one, not manufactured');
  assert.equal(held.at, agedAt, 'the held reading reports the REAL aged measurement time, not a fresh Date.now() stamp');
  // NON-VACUOUS CONTROL: the SAME aged input with no live app must still expire.
  const gone = fa.read({ nativePresent: false });
  assert.equal(gone.checkable, false, 'with no live app the same aged reading genuinely cannot be trusted');
});

test('#3213: nativePresent holds a stale NOT-granted verdict too (holds the last verdict, does not bias to granted)', () => {
  write({ granted: false, at: new Date(Date.now() - (fa.STALE_AFTER_MS + 1000)).toISOString() });
  const held = fa.read({ nativePresent: true });
  assert.equal(held.checkable, true);
  assert.equal(held.granted, false, 'holds the real last verdict, never invents granted');
});

test('#3213 caveat a: nativePresent must NEVER manufacture a verdict where none exists', () => {
  clear();
  assert.equal(fa.read({ nativePresent: true }).checkable, false, 'ENOENT (fresh install, no first fire) -> still uncheckable, never invents granted');
  write({ at: new Date(Date.now() - (fa.STALE_AFTER_MS + 1000)).toISOString() });
  assert.equal(fa.read({ nativePresent: true }).checkable, false, 'a verdict-less reading is not a verdict to hold');
  write({ granted: true, at: 'whenever' });
  assert.equal(fa.read({ nativePresent: true }).checkable, false, 'a timeless reading cannot be aged or held');
});

test('#3213: nativePresent does not change a FRESH reading (it only extends an aged one)', () => {
  write({ granted: true, at: new Date().toISOString() });
  assert.equal(fa.read({ nativePresent: true }).checkable, true);
  assert.equal(fa.read({ nativePresent: false }).checkable, true, 'a fresh reading is checkable regardless of nativePresent');
});

test('#3213 backward-compat: read() with no opts is fail-safe (no live-app signal -> aged expires)', () => {
  write({ granted: true, at: new Date(Date.now() - (fa.STALE_AFTER_MS + 1000)).toISOString() });
  assert.equal(fa.read().checkable, false, 'the default treats nativePresent as false, preserving the pre-#3213 behavior');
});

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

'use strict';
/**
 * a11ystatus: the engine's read side of the native Accessibility verdict (#2125
 * slice 3). The load-bearing property is the THREE-answers discipline: "the app
 * says NOT trusted" must be distinguishable from "we cannot check at all", because
 * the gate blocks only on the FORMER and must never false-block a browser (the
 * latter) nor let a UI claim a state nobody measured.
 *
 *   node --test engine/a11ystatus.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-a11y-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const a11y = require('./a11ystatus');

function write(obj) {
  fs.mkdirSync(path.dirname(a11y.FILE), { recursive: true });
  fs.writeFileSync(a11y.FILE, JSON.stringify(obj));
}
function clear() { try { fs.rmSync(a11y.FILE, { force: true }); } catch { /* */ } }

test('no file at all -> checkable:false (a browser / not-yet-checked), NOT trusted:false', () => {
  clear();
  const r = a11y.read();
  assert.equal(r.checkable, false);
  assert.equal(r.trusted, undefined, 'must not claim a trusted verdict when nothing was measured');
});

test('a fresh trusted verdict -> checkable:true, trusted:true', () => {
  write({ trusted: true, at: new Date().toISOString() });
  const r = a11y.read();
  assert.equal(r.checkable, true);
  assert.equal(r.trusted, true);
});

test('a fresh NOT-trusted verdict -> checkable:true, trusted:false (the only state that gates)', () => {
  write({ trusted: false, at: new Date().toISOString() });
  const r = a11y.read();
  assert.equal(r.checkable, true);
  assert.equal(r.trusted, false);
});

test('THE DISCRIMINATOR: not-trusted and uncheckable are different answers', () => {
  write({ trusted: false, at: new Date().toISOString() });
  const gated = a11y.read();
  clear();
  const uncheckable = a11y.read();
  // The gate blocks on `gated` (checkable && !trusted) and NOT on `uncheckable`.
  assert.equal(gated.checkable && gated.trusted === false, true, 'this one gates');
  assert.equal(uncheckable.checkable, false, 'this one does NOT gate (fail-safe)');
});

test('a stale verdict falls back to uncheckable (the app is not maintaining it)', () => {
  write({ trusted: true, at: new Date(Date.now() - (a11y.STALE_AFTER_MS + 1000)).toISOString() });
  const r = a11y.read();
  assert.equal(r.checkable, false, 'a days-old reading must not gate on or vouch for anything');
});

test('a malformed verdict (no boolean trusted) -> uncheckable, never a throw', () => {
  write({ trusted: 'yes', at: new Date().toISOString() });
  assert.equal(a11y.read().checkable, false);
  write({ at: new Date().toISOString() });
  assert.equal(a11y.read().checkable, false);
  fs.writeFileSync(a11y.FILE, 'not json');
  assert.equal(a11y.read().checkable, false);
});

test('a verdict with no readable time -> uncheckable (cannot judge freshness)', () => {
  write({ trusted: true, at: 'whenever' });
  assert.equal(a11y.read().checkable, false);
});

'use strict';
/**
 * #3016: the anchor REFUSES to re-point the fleet to an older build.
 *
 * 🛑 THE DEFECT. On Windows the shipped bundle is a portable zip and the launcher
 * runs its own folder's app/server.js, whose boot lands in
 * `win32anchor.ensureAnchored` and rewrites the shared `engine-path` pointer -- the
 * one indirection every Scheduled Task and every agent supervisor reads. So
 * double-clicking an OLDER unpacked Kosmos.exe used to silently downgrade the whole
 * running fleet. Josh's rule (windows-updater-decisions #6): never downgrade.
 *
 * Every arm runs on ANY host: the filesystem work is in an absolute temp sandbox
 * and the platform/anchor/engine are all passed in, so a Mac exercises the win32
 * guard and no suite touches the operator's real %LOCALAPPDATA%.
 *
 *   node --test engine/win32anchor.downgrade-3016.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const anchor = require('./win32anchor');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-anchor-downgrade-3016-'));
test.after(() => { try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* best effort */ } });

/* A bundle laid out as build-kosmos-windows.sh ships it: <root>/app/engine and a
   <root>/app/package.json naming the version buildIdentity reads. Returns the engine
   dir, which is what a boot passes as engineDir. */
function bundle(name, version) {
  const app = path.join(ROOT, name, 'app');
  const engine = path.join(app, 'engine');
  fs.mkdirSync(engine, { recursive: true });
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ version }));
  return engine;
}

/* A stand-in for the 92 MB interpreter, so no arm copies a real node.exe. */
const STUB_NODE = path.join(ROOT, 'node-stub');
fs.writeFileSync(STUB_NODE, 'stand-in for a 92 MB interpreter', 'utf8');

function anchorInto(dataDir, engineDir) {
  return anchor.ensureAnchored({
    platform: process.platform, home: ROOT, env: { AGENT_WORKFORCE_DATA: dataDir },
    node: STUB_NODE, engineDir,
  });
}
function pointerOf(dataDir) {
  return path.join(anchor.anchorDir(process.platform, ROOT, { AGENT_WORKFORCE_DATA: dataDir }), anchor.POINTER_NAME);
}

test('an OLDER build is REFUSED, and the fleet pointer is left naming the newer one', () => {
  const data = path.join(ROOT, 'd1'); fs.mkdirSync(data, { recursive: true });
  const newer = bundle('v060', '0.6.60');
  const older = bundle('v055', '0.6.55');

  const first = anchorInto(data, newer);
  assert.equal(first.ok, true, first.because);
  assert.ok(!first.downgrade, 'a first install has no pointer to downgrade');
  assert.equal(fs.readFileSync(pointerOf(data), 'utf8').trim(), newer);

  const down = anchorInto(data, older);
  assert.equal(down.ok, true, 'the boot must still succeed -- the caller hands off to the newer copy');
  assert.equal(down.downgrade, true, 'the older build is a refused downgrade');
  assert.equal(down.keptEngine, newer);
  assert.equal(fs.readFileSync(pointerOf(data), 'utf8').trim(), newer,
    'the shared engine pointer must NOT be moved to the older build');
});

test('the FIRST install (no pointer yet) writes normally', () => {
  const data = path.join(ROOT, 'd2'); fs.mkdirSync(data, { recursive: true });
  const only = bundle('v058', '0.6.58');
  const r = anchorInto(data, only);
  assert.equal(r.ok, true, r.because);
  assert.ok(!r.downgrade);
  assert.equal(fs.readFileSync(pointerOf(data), 'utf8').trim(), only);
});

test('a NEWER double-click moves the pointer FORWARD (update to the newest copy)', () => {
  const data = path.join(ROOT, 'd3'); fs.mkdirSync(data, { recursive: true });
  const older = bundle('v059', '0.6.59');
  const newer = bundle('v061', '0.6.61');
  anchorInto(data, older);
  const up = anchorInto(data, newer);
  assert.ok(!up.downgrade, 'a strictly newer build is a legitimate forward move');
  assert.equal(fs.readFileSync(pointerOf(data), 'utf8').trim(), newer);
});

test('a SAME-version reinstall/repair from a different folder still re-points', () => {
  const data = path.join(ROOT, 'd4'); fs.mkdirSync(data, { recursive: true });
  const a = bundle('v060a', '0.6.60');
  const b = bundle('v060b', '0.6.60');
  anchorInto(data, a);
  const again = anchorInto(data, b);
  assert.ok(!again.downgrade, 'equal versions differ only by sha, which is unordered: never a downgrade');
  assert.equal(fs.readFileSync(pointerOf(data), 'utf8').trim(), b);
});

test('an unreadable version on either side fails OPEN to today\'s behaviour', () => {
  const data = path.join(ROOT, 'd5'); fs.mkdirSync(data, { recursive: true });
  const versioned = bundle('v060c', '0.6.60');
  /* An engine dir whose ../package.json cannot be read (no app/package.json). */
  const noVersion = path.join(ROOT, 'nover', 'app', 'engine');
  fs.mkdirSync(noVersion, { recursive: true });
  anchorInto(data, versioned);
  const r = anchorInto(data, noVersion);
  assert.ok(!r.downgrade, 'unknown version is never proven older, so the write proceeds as before');
  assert.equal(fs.readFileSync(pointerOf(data), 'utf8').trim(), noVersion);
});

'use strict';
/**
 * #3016: an OLDER Kosmos.exe neither re-points the fleet nor re-registers the board
 * task; ensureInstalled reports the downgrade so the boot hands off to the newer copy.
 *
 * 🛑 NO REAL schtasks, NO REAL ANCHOR. The anchorer is stubbed to answer as
 * win32anchor.ensureAnchored does when it refuses a downgrade (`downgrade:true`), and
 * every schtasks call goes through setRunner, so a Mac exercises this and no suite
 * touches Task Scheduler or the operator's %LOCALAPPDATA%.
 *
 *   node --test engine/win32board.downgrade-3016.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const board = require('./win32board');

const ANCHOR = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-win32board-3016-'));
test.after(() => { try { fs.rmSync(ANCHOR, { recursive: true, force: true }); } catch { /* best effort */ } });

const ENV = { USERNAME: 'joshu', USERDOMAIN: 'PIZZARAMA', AGENT_WORKFORCE_DATA: ANCHOR };
const KEPT_ENGINE = 'C:\\Kosmos\\v060\\app\\engine';

/* The anchor's answer when it refuses to downgrade: it wrote nothing, kept the newer
   pointer, and still returns the anchor's real paths (win32anchor.ensureAnchored). */
function anchorRefusesDowngrade() {
  return {
    ok: true, downgrade: true, keptEngine: KEPT_ENGINE,
    node: path.join(ANCHOR, 'node.exe'), boot: path.join(ANCHOR, 'supervisor-boot.js'),
    dir: ANCHOR, pointer: path.join(ANCHOR, 'engine-path'),
  };
}

const NOT_FOUND = { ok: false, out: 'ERROR: The system cannot find the file specified.' };
/* A schtasks stub: every /Query answers "no such task" (known, unregistered); anything
   else (a /Create) succeeds. Every call is recorded so the test can prove whether
   /Create ran. */
function runner() {
  const calls = [];
  const fn = (args) => {
    calls.push(args.join(' '));
    return args[0] === '/Query' ? NOT_FOUND : { ok: true, out: '' };
  };
  fn.calls = calls;
  return fn;
}

/* isKosmosBuildRoot reads a manifest; the seam makes this build look like a real win32
   bundle so BOTH the anchorBundle re-point AND install's register are exercised. */
const BUNDLE = {
  platform: 'win32', env: ENV, home: ANCHOR, root: 'C:\\Kosmos\\v055',
  exists: () => true, readManifest: () => ({ product: 'kosmos', platform: 'win32' }),
};

test('an older Kosmos.exe: ensureInstalled reports the downgrade and touches no task (#3016)', () => {
  board.setAnchorer(anchorRefusesDowngrade);
  const r = runner();
  board.setRunner(r);
  board.setSpawner(() => ({ unref() {} }));

  const out = board.ensureInstalled(BUNDLE);

  assert.equal(out.ok, true, out.because);
  assert.equal(out.downgrade, true, 'the downgrade must be surfaced for the hand-off');
  assert.equal(out.action, 'left-newer');
  assert.ok(!r.calls.some((c) => c.includes('/Create')),
    'the older build must NOT re-register the board task (that would clobber the newer boot shim)');
  assert.ok(!board.claimed({ platform: 'win32', env: ENV, home: ANCHOR }),
    'the older build must not claim the task');
});

test('a NEWER/equal build (anchor did not refuse) still registers as before', () => {
  board.setAnchorer(() => ({
    ok: true, node: path.join(ANCHOR, 'node.exe'), boot: path.join(ANCHOR, 'supervisor-boot.js'),
    dir: ANCHOR, pointer: path.join(ANCHOR, 'engine-path'),
  }));
  const r = runner();
  board.setRunner(r);
  board.setSpawner(() => ({ unref() {} }));

  const out = board.ensureInstalled(BUNDLE);

  assert.equal(out.ok, true, out.because);
  assert.ok(!out.downgrade);
  assert.equal(out.action, 'registered');
  assert.ok(r.calls.some((c) => c.startsWith('/Create /F /TN Kosmos\\board')),
    'a build that is not older registers the task exactly as today');
});

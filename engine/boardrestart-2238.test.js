'use strict';
/**
 * #2238: the board self-restart guard must FAIL SAFE. A wrong branch here bricks
 * a board (a from-source `node server.js` stopped with no KeepAlive never comes
 * back), so every uncertainty must answer canRestart:false, and selfRestart must
 * refuse unless canSelfRestart positively confirmed. These assertions drive the
 * detection against a fixture LaunchAgents dir (AGENT_WORKFORCE_LAUNCH) and a
 * stubbed launchctl (setRunner) - no real launchd, no real board.
 *
 *   node --test engine/boardrestart-2238.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const LAUNCH = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-boardrestart-2238-'));
process.env.AGENT_WORKFORCE_LAUNCH = LAUNCH;

const board = require('./boardrestart');
// The module derives the plist path from AGENT_WORKFORCE_LAUNCH + the board label;
// the test writes the fixture at the same path (kept internal to the module).
const PLIST = nodePath.join(LAUNCH, 'com.kosmos.board.plist');

const KEEPALIVE_TRUE = `<?xml version="1.0"?><plist><dict>
  <key>Label</key><string>com.kosmos.board</string>
  <key>KeepAlive</key><true/>
  <key>ProgramArguments</key><array><string>node</string><string>server.js</string></array>
</dict></plist>`;
const KEEPALIVE_DICT = `<?xml version="1.0"?><plist><dict>
  <key>Label</key><string>com.kosmos.board</string>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
</dict></plist>`;
const NO_KEEPALIVE = `<?xml version="1.0"?><plist><dict>
  <key>Label</key><string>com.kosmos.board</string>
  <key>RunAtLoad</key><true/>
</dict></plist>`;

function writePlist(xml) { fs.writeFileSync(PLIST, xml); }
function rmPlist() { try { fs.rmSync(PLIST, { force: true }); } catch { /* best effort */ } }
// A launchctl print stub whose job is running under a given pid.
function printStub(pid) {
  return (cmd, args) => {
    if (cmd === 'launchctl' && args[0] === 'print') return { ok: true, stdout: `com.kosmos.board = {\n\tactive count = 1\n\tpid = ${pid}\n\tstate = running\n}` };
    if (cmd === 'launchctl' && args[0] === 'stop') return { ok: true, stdout: '' };
    return { ok: false, because: 'unexpected command' };
  };
}

test.beforeEach(() => { rmPlist(); board.setRunner(printStub(process.pid)); });

// ── the ONE happy path ──────────────────────────────────────────────────────
test('canRestart TRUE only when: plist + unconditional KeepAlive + launchd runs THIS pid', () => {
  writePlist(KEEPALIVE_TRUE);
  board.setRunner(printStub(process.pid));
  const r = board.canSelfRestart();
  assert.equal(r.canRestart, true, r.because);
});

// ── every fail-safe branch: each must be FALSE ──────────────────────────────
test('FALSE: no plist (from-source / unmanaged board)', () => {
  rmPlist(); // no com.kosmos.board.plist at all
  assert.equal(board.canSelfRestart().canRestart, false);
});

test('FALSE: plist present but no KeepAlive', () => {
  writePlist(NO_KEEPALIVE);
  assert.equal(board.canSelfRestart().canRestart, false);
});

test('FALSE: CONDITIONAL KeepAlive (a dict) is not trusted to relaunch', () => {
  writePlist(KEEPALIVE_DICT);
  assert.equal(board.canSelfRestart().canRestart, false);
});

test('FALSE: launchctl print fails (cannot confirm the job is loaded)', () => {
  writePlist(KEEPALIVE_TRUE);
  board.setRunner(() => ({ ok: false, because: 'no such service' }));
  assert.equal(board.canSelfRestart().canRestart, false);
});

test('FALSE: launchctl print has no pid line (job not running / shape unknown)', () => {
  writePlist(KEEPALIVE_TRUE);
  board.setRunner((cmd, args) => (cmd === 'launchctl' && args[0] === 'print')
    ? { ok: true, stdout: 'com.kosmos.board = {\n\tstate = not running\n}' } : { ok: true, stdout: '' });
  assert.equal(board.canSelfRestart().canRestart, false);
});

test('FALSE: the running pid is NOT this process (stopping it would not restart us)', () => {
  writePlist(KEEPALIVE_TRUE);
  board.setRunner(printStub(process.pid + 1)); // some other board process
  assert.equal(board.canSelfRestart().canRestart, false);
});

// ── selfRestart obeys the guard ─────────────────────────────────────────────
test('selfRestart REFUSES (no stop issued) when canSelfRestart is false', () => {
  rmPlist();
  let stopped = false;
  board.setRunner((cmd, args) => { if (args && args[0] === 'stop') stopped = true; return { ok: true, stdout: '' }; });
  const r = board.selfRestart();
  assert.equal(r.ok, false);
  assert.equal(stopped, false, 'a refused restart must never issue launchctl stop');
});

test('selfRestart issues launchctl stop on the happy path', () => {
  writePlist(KEEPALIVE_TRUE);
  const calls = [];
  board.setRunner((cmd, args) => {
    calls.push(args.join(' '));
    if (args[0] === 'print') return { ok: true, stdout: `pid = ${process.pid}` };
    return { ok: true, stdout: '' };
  });
  const r = board.selfRestart();
  assert.equal(r.ok, true, r.because);
  assert.ok(calls.some((c) => c.startsWith('stop ')), 'issued a launchctl stop');
});

test('selfRestart falls back to the bare-label stop when the gui-domain form fails', () => {
  writePlist(KEEPALIVE_TRUE);
  const stops = [];
  board.setRunner((cmd, args) => {
    if (args[0] === 'print') return { ok: true, stdout: `pid = ${process.pid}` };
    if (args[0] === 'stop') {
      stops.push(args[1]);
      return args[1].includes('gui/') ? { ok: false, because: 'domain miss' } : { ok: true, stdout: '' };
    }
    return { ok: true, stdout: '' };
  });
  const r = board.selfRestart();
  assert.equal(r.ok, true, r.because);
  assert.equal(stops.length, 2, 'tried gui-domain then bare label');
  assert.equal(stops[1], 'com.kosmos.board');
});

test.after(() => { try { fs.rmSync(LAUNCH, { recursive: true, force: true }); } catch { /* best effort */ } });

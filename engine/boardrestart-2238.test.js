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
// A launchctl print stub whose job is running under a given pid, with keepalive
// loaded (the `properties = ... keepalive ...` line real launchd prints for a
// KeepAlive job). `keepalive:false` drops that line to model a disabled / reloaded-
// away job whose disk plist still says KeepAlive.
function printStub(pid, { keepalive = true } = {}) {
  const props = keepalive ? '\n\tproperties = keepalive | runatload | inferred program' : '\n\tproperties = runatload | inferred program';
  return (cmd, args) => {
    if (cmd === 'launchctl' && args[0] === 'print') return { ok: true, stdout: `com.kosmos.board = {\n\tactive count = 1\n\tpid = ${pid}\n\tstate = running${props}\n}` };
    if (cmd === 'launchctl' && args[0] === 'stop') return { ok: true, stdout: '' };
    return { ok: false, because: 'unexpected command' };
  };
}

// #2454: isolate the launchctl-KeepAlive arm below from the new installed-board
// `kosmos restart` arm -- installedCli null means "not an installed board", so
// these tests exercise ONLY the dev launchd path (no real install can leak in and
// turn a fail-safe FALSE into a TRUE). The kosmos-path tests set it explicitly.
test.beforeEach(() => { rmPlist(); board.setRunner(printStub(process.pid)); board.setInstalledCli(() => null); });

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

test('FALSE: the LOADED job has no keepalive (disabled / reloaded away) even though the disk plist still says KeepAlive', () => {
  // The divergence hole: disk plist says unconditional KeepAlive, but the running
  // launchd job no longer has keepalive active. The LOADED config is authoritative
  // -- a stop would not relaunch, so we must refuse (would otherwise brick).
  writePlist(KEEPALIVE_TRUE);
  board.setRunner(printStub(process.pid, { keepalive: false }));
  assert.equal(board.canSelfRestart().canRestart, false, 'the loaded config, not the disk plist, decides whether a stop relaunches');
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
    if (args[0] === 'print') return { ok: true, stdout: `pid = ${process.pid}\n\tproperties = keepalive | runatload` };
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
    if (args[0] === 'print') return { ok: true, stdout: `pid = ${process.pid}\n\tproperties = keepalive | runatload` };
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

// ── #2454: the INSTALLED-board `kosmos restart` path ────────────────────────
// The installed board is RunAtLoad + no KeepAlive and is a detached grandchild of
// launchd, so the launchctl arm is (correctly) FALSE for it -- the kosmos arm is
// what restarts it. These tests stub the installed-cli probe and the spawner so no
// real kosmos is located or run.

test('kosmos path: canRestart TRUE via kosmos when installed, even with NO KeepAlive', () => {
  writePlist(NO_KEEPALIVE);           // the installed board's real plist shape
  board.setInstalledCli(() => '/home/bin/kosmos');
  const r = board.canSelfRestart();
  assert.equal(r.canRestart, true, r.because);
  assert.equal(r.via, 'kosmos');
  assert.equal(r.cli, '/home/bin/kosmos');
});

test('kosmos path: canRestart TRUE via kosmos even with NO plist at all', () => {
  rmPlist();
  board.setInstalledCli(() => '/home/bin/kosmos');
  const r = board.canSelfRestart();
  assert.equal(r.canRestart, true, r.because);
  assert.equal(r.via, 'kosmos');
});

test('launchctl WINS over kosmos when the dev KeepAlive job is viable', () => {
  // A dev box that is ALSO somehow installed still prefers the atomic launchd op.
  writePlist(KEEPALIVE_TRUE);
  board.setRunner(printStub(process.pid));
  board.setInstalledCli(() => '/home/bin/kosmos');
  const r = board.canSelfRestart();
  assert.equal(r.canRestart, true, r.because);
  assert.equal(r.via, 'launchctl');
});

test('FALSE: not installed AND not a KeepAlive job (from-source node server.js) -> manual', () => {
  rmPlist();
  board.setInstalledCli(() => null);  // clipath returns null for a from-source board
  const r = board.canSelfRestart();
  assert.equal(r.canRestart, false);
  assert.match(r.because, /from-source|by hand/i);
});

test('selfRestart via kosmos spawns a DETACHED `kosmos restart`, unref\'d, and NEVER issues launchctl stop', () => {
  writePlist(NO_KEEPALIVE);
  board.setInstalledCli(() => '/home/bin/kosmos');
  let stopped = false;
  board.setRunner((cmd, args) => { if (args && args[0] === 'stop') stopped = true; return { ok: true, stdout: '' }; });
  let spawned = null;
  let unrefd = false;
  board.setSpawner((cmd, args, opts) => { spawned = { cmd, args, opts }; return { unref() { unrefd = true; } }; });
  const r = board.selfRestart();
  assert.equal(r.ok, true, r.because);
  assert.equal(stopped, false, 'the kosmos path must never issue launchctl stop (would target an exited login job)');
  assert.ok(spawned, 'spawned a child');
  assert.equal(spawned.cmd, '/home/bin/kosmos');
  assert.deepEqual(spawned.args, ['restart']);
  assert.equal(spawned.opts.detached, true, 'detached so it outlives the board it stops');
  assert.equal(spawned.opts.stdio, 'ignore');
  assert.equal(unrefd, true, 'unref\'d so it never holds a handle');
});

test('selfRestart via kosmos STRIPS the world-override env (a switch to default must not bleed old-world data)', () => {
  writePlist(NO_KEEPALIVE);
  board.setInstalledCli(() => '/home/bin/kosmos');
  process.env.AGENT_WORKFORCE_DATA = '/old/world/data';
  process.env.AGENT_WORKFORCE_PROJECTS = '/old/world/projects';
  process.env.AGENT_WORKFORCE_WORKERS = '/old/world/workers';
  process.env.KOSMOS_HOME = '/keep/me';   // a non-world var must survive
  let spawned = null;
  board.setSpawner((cmd, args, opts) => { spawned = { cmd, args, opts }; return { unref() {} }; });
  const r = board.selfRestart();
  assert.equal(r.ok, true, r.because);
  assert.equal(spawned.opts.env.AGENT_WORKFORCE_DATA, undefined, 'stripped -> fresh board re-derives from the registry');
  assert.equal(spawned.opts.env.AGENT_WORKFORCE_PROJECTS, undefined);
  assert.equal(spawned.opts.env.AGENT_WORKFORCE_WORKERS, undefined);
  assert.equal(spawned.opts.env.KOSMOS_HOME, '/keep/me', 'non-world env is preserved');
  delete process.env.AGENT_WORKFORCE_DATA; delete process.env.AGENT_WORKFORCE_PROJECTS;
  delete process.env.AGENT_WORKFORCE_WORKERS; delete process.env.KOSMOS_HOME;
});

test('selfRestart via kosmos reports a spawn failure instead of throwing', () => {
  writePlist(NO_KEEPALIVE);
  board.setInstalledCli(() => '/home/bin/kosmos');
  board.setSpawner(() => { throw new Error('EAGAIN'); });
  const r = board.selfRestart();
  assert.equal(r.ok, false);
  assert.match(r.because, /EAGAIN|could not start/i);
});

test.after(() => { try { fs.rmSync(LAUNCH, { recursive: true, force: true }); } catch { /* best effort */ } });

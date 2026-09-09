'use strict';
/**
 * #570 BLOCKER 4, half two: a Windows board can be BOUNCED, and when it cannot it
 * says which of the two reasons applies.
 *
 * 🛑 THE FAIL-SAFE IS THE SAME ONE #2238 BUILT, ON A DIFFERENT PROOF. A restart
 * that stops a board nothing will start again is a bricked board, so every
 * uncertainty answers canRestart:false. On Windows the positive proof is not a
 * launchd pid match -- it is that THIS board carries the marker its logon task
 * stamps (engine/win32board.MARKER_ENV). Without it, `/End` stops nothing and
 * `/Run` would start a SECOND board that dies on the port: a restart that
 * reported success and did nothing.
 *
 * ⚠️ THE WHOLE win32board MODULE IS STUBBED THROUGH `setBoardOps`, so no real
 * `schtasks` runs and no real board is ever ended.
 *
 *   node --test engine/boardrestart.win32-570.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const board = require('./boardrestart');

/* A win32board stand-in. `status` is what the guard reads; `restart` records that
   the bounce was actually driven. */
function ops(status, started) {
  const o = {
    TASK_NAME: 'Kosmos\\board',
    status: () => status,
    startedByTask: () => started,
    restarted: false,
    restart() { o.restarted = true; return { ok: true }; },
  };
  return o;
}

test.afterEach(() => { board.setBoardOps(null); });

test('canRestart TRUE only when the task is registered, enabled, AND started this board', () => {
  const o = ops({ registered: true, enabled: true, running: true }, true);
  board.setBoardOps(() => o);
  const r = board.canSelfRestart('win32');
  assert.equal(r.canRestart, true, r.because);
  assert.equal(r.via, 'schtasks');
});

test('FALSE: nothing registered -- and it says nothing starts the board at logon', () => {
  board.setBoardOps(() => ops({ registered: false }, true));
  const r = board.canSelfRestart('win32');
  assert.equal(r.canRestart, false);
  assert.match(r.because, /nothing on this computer starts the board at logon/);
  assert.match(r.because, /by hand/, 'a refusal must name something the person can do');
});

test('FALSE: the task is switched off -- and it names the task', () => {
  board.setBoardOps(() => ops({ registered: true, enabled: false }, true));
  const r = board.canSelfRestart('win32');
  assert.equal(r.canRestart, false);
  assert.match(r.because, /Kosmos\\board/);
  assert.match(r.because, /switched off/);
});

test('FALSE: a hand-started board (Kosmos.exe / node server.js) is never stopped by this path', () => {
  board.setBoardOps(() => ops({ registered: true, enabled: true }, false));
  const r = board.canSelfRestart('win32');
  assert.equal(r.canRestart, false);
  assert.match(r.because, /started by hand/);
});

test('FALSE, not a throw, when the Windows module cannot even be read', () => {
  board.setBoardOps(() => { throw new Error('boom'); });
  const r = board.canSelfRestart('win32');
  assert.equal(r.canRestart, false);
  assert.match(r.because, /could not check/);
});

test('selfRestart drives win32board.restart on the happy path', () => {
  const o = ops({ registered: true, enabled: true }, true);
  board.setBoardOps(() => o);
  const r = board.selfRestart('win32');
  assert.equal(r.ok, true, r.because);
  assert.equal(o.restarted, true);
});

test('selfRestart REFUSES and drives NOTHING when the guard is false', () => {
  const o = ops({ registered: true, enabled: true }, false); // not our board
  board.setBoardOps(() => o);
  const r = board.selfRestart('win32');
  assert.equal(r.ok, false);
  assert.equal(o.restarted, false, 'a refused restart must never end a board somebody else started');
});

test('the win32 arm NEVER consults the kosmos CLI (the Windows bundle ships no bin\\kosmos)', () => {
  let asked = false;
  board.setInstalledCli(() => { asked = true; return 'C:\\anything\\kosmos'; });
  board.setBoardOps(() => ops({ registered: false }, false));
  board.canSelfRestart('win32');
  assert.equal(asked, false, 'a path that cannot exist on this platform must not be able to turn the guard true');
  board.setInstalledCli(() => null);
});

test('the platform is a PARAMETER: asking for darwin on this box still takes the launchd arm', () => {
  board.setBoardOps(() => { throw new Error('the win32 arm must not be reached'); });
  board.setUid(() => 501);
  board.setRunner(() => ({ ok: false, because: 'no such service' }));
  const r = board.canSelfRestart('darwin');
  assert.equal(r.canRestart, false);
  assert.match(r.because, /launchd|by hand/i);
});

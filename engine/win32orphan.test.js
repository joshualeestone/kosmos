'use strict';
/**
 * #570: a Windows agent or board leaves when its headless conhost host is gone.
 *
 *   node --test engine/win32orphan.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const orphan = require('./win32orphan');

/** A hand-cranked interval: `tick()` runs the check once. */
function manualTimer() {
  let fn = null;
  let cleared = false;
  return {
    setInterval: (f) => { fn = f; return { unref() {} }; },
    clearInterval: () => { cleared = true; },
    tick: () => { if (fn && !cleared) fn(); },
    get cleared() { return cleared; },
  };
}

test('#570 it calls onGone once the parent is gone, and not before', () => {
  const t = manualTimer();
  let alive = true;
  const gone = [];
  const w = orphan.exitWhenParentGone({ parentPid: 4242, isAlive: () => alive, onGone: (pid) => gone.push(pid), ...t });
  assert.equal(w.armed, true);
  t.tick(); t.tick();
  assert.deepEqual(gone, [], 'a living parent is left alone');
  alive = false;
  t.tick();
  assert.deepEqual(gone, [4242]);
  assert.equal(t.cleared, true, 'the watch stops itself once it has fired');
  t.tick();
  assert.deepEqual(gone, [4242], 'it fires once');
});

test('#570 a check that throws counts as ALIVE: a doubt never makes a process leave', () => {
  const t = manualTimer();
  const gone = [];
  orphan.exitWhenParentGone({ parentPid: 1, isAlive: () => { throw new Error('flaky'); }, onGone: () => gone.push(1), ...t });
  t.tick();
  assert.deepEqual(gone, []);
});

test('#570 a throwing onGone does not escape into the process it guards', () => {
  const t = manualTimer();
  orphan.exitWhenParentGone({ parentPid: 1, isAlive: () => false, onGone: () => { throw new Error('boom'); }, ...t });
  assert.doesNotThrow(() => t.tick());
});

test('#570 stop() cancels the watch', () => {
  const t = manualTimer();
  const gone = [];
  const w = orphan.exitWhenParentGone({ parentPid: 1, isAlive: () => false, onGone: () => gone.push(1), ...t });
  w.stop();
  t.tick();
  assert.deepEqual(gone, []);
  assert.equal(t.cleared, true);
});

test('#570 a parent pid that is no process at all arms nothing', () => {
  /* A non-integer is "not given" and falls back to the real parent; only a pid
     that is an integer and could never be a process refuses outright. */
  for (const parentPid of [0, -1]) {
    const w = orphan.exitWhenParentGone({ parentPid, isAlive: () => false, onGone: () => { throw new Error('must not run'); }, ...manualTimer() });
    assert.equal(w.armed, false, String(parentPid));
  }
});

test('#570 the real check: this process is alive; a pid that is certainly gone is not', () => {
  assert.equal(orphan.pidAlive(process.pid), true);
  /* A child that has already exited: its pid is gone. Spawned and awaited here so
     the pid is real and known dead, rather than guessed. */
  const r = require('node:child_process').spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' });
  assert.equal(r.status, 0);
  assert.equal(orphan.pidAlive(r.pid), false, 'an exited child reads as gone');
});

test('#570 the real default timer is unref\'d, so the watch alone never holds a process open', () => {
  const w = orphan.exitWhenParentGone({ parentPid: process.pid, onGone: () => {} });
  assert.equal(w.armed, true);
  assert.equal(w.timer.hasRef(), false, 'the watch must not keep a stopped supervisor or board alive');
  w.stop();
});

test('#570 EPERM is ALIVE (a process we may not signal is still there); only ESRCH is gone', () => {
  const throwing = (code) => () => { throw Object.assign(new Error(code), { code }); };
  assert.equal(orphan.pidAlive(1, throwing('EPERM')), true);
  assert.equal(orphan.pidAlive(1, throwing('ESRCH')), false);
  assert.equal(orphan.pidAlive(1, throwing('EWHATEVER')), true, 'anything unreadable fails toward staying up');
  assert.equal(orphan.pidAlive(1, () => true), true);
});

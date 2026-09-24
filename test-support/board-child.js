'use strict';
/**
 * Stopping a board a test spawned, and knowing it has stopped (#3607).
 *
 * Tests that spawn `server.js` delete their sandbox right after. If the test
 * only SENDS the kill and moves on, the board can still be writing boot-time
 * state into that sandbox, and under a loaded machine `fs.rmSync` meets a
 * directory that refilled underneath it: ENOTEMPTY. So a test awaits
 * `stopBoard` before it deletes anything, and asserts the `dead` it returns.
 *
 * Covered by test-support.board-child.test.js.
 */

/* A board honours SIGTERM in well under a second; five is generous headroom on
   a loaded machine before escalating to SIGKILL. */
const GRACE_MS = 5000;
/* Past GRACE_MS plus the time a SIGKILLed process takes to be reaped. Exists at
   all because tools/run-tests.sh runs node --test with no per-test timeout, so a
   child that never reports back would otherwise hang the whole suite. */
const GIVE_UP_MS = 10000;
/* How long a boot test waits for the "Kosmos on http" banner. */
const BANNER_TIMEOUT_MS = 8000;

/**
 * Stop the child (`signal`, SIGTERM by default), SIGKILL it after `graceMs`,
 * and resolve once it has exited. Waits on 'exit' rather than 'close': a
 * grandchild that inherited the stdio pipes can hold 'close' open long after
 * the board itself is gone. Resolves `dead` (from the child's own exit or
 * signal code) rather than rejecting, and logs if it had to give up.
 */
function stopBoard(child, { signal = 'SIGTERM', graceMs = GRACE_MS, giveUpMs = GIVE_UP_MS } = {}) {
  const isDead = () => child.exitCode !== null || child.signalCode !== null;
  if (isDead()) return Promise.resolve(true);
  /* 'exit' only. A failed signal emits 'error' while the board still runs, and
     that must not end the wait or skip the SIGKILL. */
  const exited = new Promise((r) => { child.once('exit', () => r('exit')); });
  child.on('error', () => { /* a failed signal; the escalation and give-up still apply */ });
  try { child.kill(signal); } catch { /* already gone */ }
  const hard = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, graceMs);
  let giveUp;
  const gaveUp = new Promise((r) => { giveUp = setTimeout(() => r('gave-up'), giveUpMs); });
  return Promise.race([exited, gaveUp]).then((how) => {
    clearTimeout(hard);
    clearTimeout(giveUp);
    if (how === 'gave-up') console.error(`stopBoard: pid ${child.pid} did not report an exit within ${giveUpMs}ms`);
    return isDead();
  });
}

/**
 * Collect a spawned board's output until it prints its banner (then wait
 * `settleMs` more), exits, or `timeoutMs` passes, then stop it with
 * `stopBoard`. Resolves `{ out, err, dead }`.
 */
function runUntilBanner(child, { settleMs = 0, timeoutMs = BANNER_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let stopping = false;
    let settling = false;
    const done = () => {
      if (stopping) return;
      stopping = true;
      clearTimeout(timer);
      stopBoard(child).then((dead) => resolve({ out, err, dead }));
    };
    child.stdout.on('data', (b) => {
      out += b;
      if (!settling && /Kosmos on http/.test(out)) { settling = true; setTimeout(done, settleMs); }
    });
    child.stderr.on('data', (b) => { err += b; });
    /* 'close', not 'exit', here: a board that dies before its banner has output
       that explains why, and 'close' is the event after it is all read. */
    child.once('close', done);
    const timer = setTimeout(done, timeoutMs);
  });
}

module.exports = { stopBoard, runUntilBanner, GRACE_MS, GIVE_UP_MS, BANNER_TIMEOUT_MS };

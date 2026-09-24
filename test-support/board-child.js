'use strict';
/**
 * Stopping a board a test spawned, and knowing it has stopped (#3607).
 *
 * Tests that spawn `server.js` delete their sandbox right after. If the test
 * only SENDS the kill and moves on, the board can still be writing boot-time
 * state into that sandbox, and under a loaded machine `fs.rmSync` meets a
 * directory that refilled underneath it: ENOTEMPTY. So a test waits on
 * `stopBoard` before it deletes anything, and asserts the `dead` it returns.
 */

/**
 * SIGTERM the child, SIGKILL it after `graceMs`, and resolve once it has
 * closed. Resolves `dead` (from the child's own exit or signal code) rather
 * than rejecting, and gives up after `giveUpMs` so a child that never reports
 * back cannot hang the suite: node --test has no per-test timeout.
 */
function stopBoard(child, { graceMs = 5000, giveUpMs = 10000 } = {}) {
  const isDead = () => child.exitCode !== null || child.signalCode !== null;
  if (isDead()) return Promise.resolve(true);
  const closed = new Promise((r) => {
    child.once('close', r);
    child.once('error', r);
  });
  try { child.kill(); } catch { /* already gone */ }
  const hard = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, graceMs);
  let giveUp;
  const gaveUp = new Promise((r) => { giveUp = setTimeout(r, giveUpMs); });
  return Promise.race([closed, gaveUp]).then(() => {
    clearTimeout(hard);
    clearTimeout(giveUp);
    return isDead();
  });
}

/**
 * Collect a spawned board's output until it prints its banner (then wait
 * `settleMs` more) or `timeoutMs` passes, then stop it with `stopBoard`.
 * Resolves `{ out, err, dead }`.
 */
function runUntilBanner(child, { settleMs = 0, timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let stopping = false;
    const done = () => {
      if (stopping) return;
      stopping = true;
      clearTimeout(timer);
      stopBoard(child).then((dead) => resolve({ out, err, dead }));
    };
    child.stdout.on('data', (b) => { out += b; if (/Kosmos on http/.test(out)) setTimeout(done, settleMs); });
    child.stderr.on('data', (b) => { err += b; });
    const timer = setTimeout(done, timeoutMs);
  });
}

module.exports = { stopBoard, runUntilBanner };

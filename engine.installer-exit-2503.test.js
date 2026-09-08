'use strict';
/**
 * kosmos#2503: THE SPAWNED INSTALLER'S EXIT STATUS IS THE TRAILING `if`, so
 * update.js's failure-bookkeeping block was dead for every ordinary installer
 * failure.
 *
 * beginInstall spawns `sh -c 'curl | sh; code=$?; printf ... > status; if [ ... ];
 * then rm -f ...; fi'`. A shell exits with its LAST command, the trailing `if`,
 * which in production is true and exits with `rm`'s status (0). So a FINISHED
 * installer -- success OR failure -- makes the child exit 0, and the installer's
 * real code lives only in the status file. wireChild's `if (code !== 0)` therefore
 * never ran on a 404 / dropped download / checksum refusal: the single-flight flag
 * stayed stranded-true and every retry got `already:true`.
 *
 * 🛑 THE TRAP (named on the card): the natural test makes the child exit non-zero
 * and asserts the block runs -- it passes while production never reaches the case,
 * because production's child exits 0. Arm 1 below reproduces the MASKED shape (a
 * child that exits 0 with a non-zero status file), which is the only arm that fails
 * against the unfixed code. Arm 2 pins the signal-kill fallback (no status written),
 * arm 3 the stale-status guard, arm 4 success.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const updates = require('./engine/update');

function freshRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-2503-'));
  return dir;
}
function writeStatus(root, code, startedAt) {
  const logs = path.join(root, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(path.join(logs, 'install.status'), `${code} ${startedAt}\n`);
}
function cleanup() {
  updates.setInstallRunner(null);
  updates.setInstalledRoot(null);
  updates.resetCache();
}

test('#2503 arm 1 (the bug): a masked failure -- child exits 0, status file says 7 -- releases the flag and records 7', () => {
  updates.resetCache();
  const root = freshRoot();
  updates.setInstalledRoot(() => root);
  const child = new EventEmitter();
  updates.setInstallRunner(() => child);
  try {
    const ret = updates.beginInstall({ auto: true });
    assert.equal(ret, child, 'the injected child was not wired through wireChild');
    assert.equal(updates.alreadyInstalling(), true, 'the single-flight flag should be held while installing');
    const startedAt = updates.lastAttempt().startedAt;
    // The installer really failed (7); the shell recorded it, then the trailing
    // `if` made the child exit 0. This is exactly the production shape.
    writeStatus(root, 7, startedAt);
    child.emit('exit', 0);
    assert.equal(updates.alreadyInstalling(), false,
      'the stranded-true flag was not released on a masked failure (this is the bug)');
    assert.equal(updates.lastAttempt().code, 7,
      'the real installer exit code 7 was not recorded (code was read from the child, not the status file)');
    assert.ok(updates.lastAttempt().endedAt, 'the attempt was never marked ended, so lastAttempt reads perpetually in-flight');
  } finally { cleanup(); }
});

test('#2503 arm 2 (fallback): a shell killed before its printf -- child exits 5, no status file -- still runs the block with 5', () => {
  updates.resetCache();
  const root = freshRoot();               // installedRoot set, but no install.status written
  updates.setInstalledRoot(() => root);
  const child = new EventEmitter();
  updates.setInstallRunner(() => child);
  try {
    updates.beginInstall({ auto: false });
    assert.equal(updates.alreadyInstalling(), true);
    child.emit('exit', 5);                 // signal / rm failure: child's own code is the truth here
    assert.equal(updates.alreadyInstalling(), false, 'the fallback to the child code did not release the flag');
    assert.equal(updates.lastAttempt().code, 5, 'the child exit code was not used when no status file exists');
  } finally { cleanup(); }
});

test('#2503 arm 3 (stale-status guard): child exits 0, status file from ANOTHER attempt -- the block does NOT run', () => {
  updates.resetCache();
  const root = freshRoot();
  updates.setInstalledRoot(() => root);
  const child = new EventEmitter();
  updates.setInstallRunner(() => child);
  try {
    updates.beginInstall({ auto: true });
    // A leftover status file from a PRIOR attempt (different startedAt), while THIS
    // child exits 0 without having written its own. We must not read the prior code.
    writeStatus(root, 9, '1999-01-01T00:00:00.000Z');
    child.emit('exit', 0);
    assert.equal(updates.alreadyInstalling(), true,
      'a stale status file from another attempt was treated as this attempt and released the flag');
    assert.equal(updates.lastAttempt().code, null, 'a stale status code was recorded as this attempt');
  } finally { cleanup(); }
});

test('#2503 arm 4 (success): child exits 0, status file says 0 for THIS attempt -- the block does not run', () => {
  updates.resetCache();
  const root = freshRoot();
  updates.setInstalledRoot(() => root);
  const child = new EventEmitter();
  updates.setInstallRunner(() => child);
  try {
    updates.beginInstall({ auto: true });
    const startedAt = updates.lastAttempt().startedAt;
    writeStatus(root, 0, startedAt);       // a successful install (in production the board restarts here)
    child.emit('exit', 0);
    assert.equal(updates.alreadyInstalling(), true, 'a success (code 0) must not run the failure-bookkeeping block');
    assert.equal(updates.lastAttempt().code, null, 'a success recorded a failure code');
  } finally { cleanup(); }
});

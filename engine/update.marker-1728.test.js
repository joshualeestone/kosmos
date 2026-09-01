'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/* kosmos#1728: the durable in-flight witness.
 *
 * The installer is spawned detached, unref'd and stdio-ignored, so an install
 * interrupted mid-flight -- a killed board, a Ctrl-C, a crash -- leaves NO
 * trace: no exit listener (the process is gone) and no install.status (the
 * shell never reached its printf). This marker closes the gap. beginInstall
 * writes it the moment a child exists (wireChild), and the spawned shell removes
 * it when the attempt finishes, so a SURVIVING marker means the attempt was
 * interrupted -- and lastAttempt() surfaces that instead of staying silent.
 *
 * These tests never run the real installer: they use the injected-runner seam
 * (setInstallRunner) and a controlled installedRoot (setInstalledRoot), and the
 * one test that proves the shell removes the marker runs the EXACT command
 * lifted from update.js's source with a curl that fails offline, so the tail
 * (status write + marker rm) runs without an install.
 *
 *   node --test engine/update.marker-1728.test.js
 */

const update = require('./update.js');

function freshRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-1728-'));
  update.setInstalledRoot(() => dir);
  update.resetCache(); // clears installStarted + lastAttempt so beginInstall reaches the path and lastAttempt() re-seeds
  return dir;
}
function startedPath(root) { return path.join(root, 'logs', 'install.started'); }
function statusPath(root) { return path.join(root, 'logs', 'install.status'); }
function childStub() { return { on() {}, unref() {} }; } // shape wireChild requires

test('#1728: a live child writes the durable in-flight marker with the start stamp', () => {
  const root = freshRoot();
  update.setInstallRunner(() => childStub());
  update.beginInstall({});
  update.setInstallRunner(null);

  const f = startedPath(root);
  assert.equal(fs.existsSync(f), true, 'the marker exists the moment a child is live');
  assert.match(fs.readFileSync(f, 'utf8').trim(), /^\d{4}-\d\d-\d\dT/, 'it carries the ISO start stamp');
  assert.equal(update.installStartedFile(), f, 'installStartedFile() names that same marker');
});

test('#1728 CONTROL: a runner result that is not child-shaped writes NO marker', () => {
  // wireChild -- the witness point -- is only reached for a child-shaped result.
  // If the marker appeared here too, the test above would pass for the wrong reason.
  const root = freshRoot();
  update.setInstallRunner(() => ({ ok: true })); // no .on: not a child
  update.beginInstall({});
  update.setInstallRunner(null);
  assert.equal(fs.existsSync(startedPath(root)), false, 'no child, no in-flight marker');
});

test('#1728: a surviving marker with no status file surfaces as an interrupted attempt', () => {
  const root = freshRoot();
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  const startedAt = '2026-09-01T05:00:00.000Z';
  fs.writeFileSync(startedPath(root), startedAt + '\n'); // spawned, never finished -> shell never removed it

  const view = update.lastAttempt();
  assert.ok(view, 'an interrupted install is observable, not silent');
  assert.equal(view.startedAt, startedAt);
  assert.equal(view.code, null, 'the outcome is unknown -- only that it was in flight');
  assert.match(view.because, /interrupted/i);
});

test('#1728: the shell removes the marker on finish -- a completed attempt leaves none (real command)', () => {
  const root = freshRoot();
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  const marker = startedPath(root);
  const status = statusPath(root);
  const startedAt = '2026-09-01T05:00:00.000Z';
  fs.writeFileSync(marker, startedAt + '\n');

  // Lift the EXACT command from update.js's source so this test cannot drift
  // from the code. curl fails offline (file://) so no install runs; the tail
  // (status write + marker rm) runs regardless because `;` always continues.
  const src = fs.readFileSync(path.join(__dirname, 'update.js'), 'utf8');
  const m = /spawn\('\/bin\/sh', \['-c', '([^']+)'/.exec(src);
  assert.ok(m, 'the installer spawn command was found in source');
  assert.match(m[1], /rm -f "\$4"/, 'the command removes the marker ($4) on finish');

  execFileSync('/bin/sh', ['-c', m[1], 'sh', 'file:///nonexistent-kosmos-1728', status, startedAt, marker]);
  assert.equal(fs.existsSync(marker), false, 'the finish removed the marker');
  assert.equal(fs.existsSync(status), true, 'and wrote the status file the board already reads');
});

test('#1728: the spawn passes the marker path as the 4th positional ($4)', () => {
  // Wiring guard: the rm above acts on $4, so $4 must be the marker, not the URL
  // or the status file. This pins the argument order the real spawn uses.
  const src = fs.readFileSync(path.join(__dirname, 'update.js'), 'utf8');
  const m = /spawn\('\/bin\/sh', \[('-c'[\s\S]*?)\], \{/.exec(src);
  assert.ok(m, 'the spawn argument array was found');
  // args after the command: 'sh'(=$0), setupUrl()(=$1), statusFile(=$2), lastAttempt.startedAt(=$3), startedMarker(=$4)
  assert.match(m[1], /statusFile, lastAttempt\.startedAt, startedMarker\]?/, 'startedMarker is the last positional ($4)');
});

test('#1728: with no install root ($4 = /dev/null) the shell does NOT unlink the sentinel and exits 0', () => {
  // When installedRoot() is null the marker falls back to /dev/null. The command
  // must NOT try to `rm /dev/null` (a destructive op if ever run as root) and must
  // exit 0 -- a non-zero exit here would reach wireChild's exit listener and record
  // a FALSE install failure. Runs the exact command lifted from source.
  const src = fs.readFileSync(path.join(__dirname, 'update.js'), 'utf8');
  const m = /spawn\('\/bin\/sh', \['-c', '([^']+)'/.exec(src);
  assert.ok(m, 'the installer spawn command was found in source');
  let rc = 0;
  try {
    execFileSync('/bin/sh', ['-c', m[1], 'sh', 'file:///nonexistent-kosmos-1728', '/dev/null', '2026-09-01T05:00:00.000Z', '/dev/null'], { stdio: 'ignore' });
  } catch (e) { rc = e.status || 1; }
  assert.equal(rc, 0, 'the /dev/null case exits 0 (a non-zero exit would record a false failure)');
  assert.equal(fs.existsSync('/dev/null'), true, '/dev/null was not unlinked');
});

test('#1728: when both witnesses survive, the newer attempt (by start stamp) wins', () => {
  const root = freshRoot();
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  // An older attempt failed (status written); a newer attempt was then interrupted (marker).
  fs.writeFileSync(statusPath(root), '1 2026-09-01T04:00:00.000Z\n');
  fs.writeFileSync(startedPath(root), '2026-09-01T05:00:00.000Z\n');

  const view = update.lastAttempt();
  assert.equal(view.startedAt, '2026-09-01T05:00:00.000Z', 'the newer interrupted attempt wins');
  assert.equal(view.code, null, 'and reads as in-flight/interrupted, not the older failure');
});

test('#1728 CONTROL: an older stray marker does NOT mask a newer failed status', () => {
  // The picker must be a real comparison, not "marker always wins".
  const root = freshRoot();
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  fs.writeFileSync(startedPath(root), '2026-09-01T04:00:00.000Z\n'); // older stray marker
  fs.writeFileSync(statusPath(root), '1 2026-09-01T05:00:00.000Z\n'); // newer real failure

  const view = update.lastAttempt();
  assert.equal(view.startedAt, '2026-09-01T05:00:00.000Z', 'the newer failed status wins');
  assert.equal(view.code, 1);
});

test('#1728: a failed status with no marker still reports the failure (pre-#1728 behaviour preserved)', () => {
  const root = freshRoot();
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  fs.writeFileSync(statusPath(root), '1 2026-09-01T04:00:00.000Z\n');

  const view = update.lastAttempt();
  assert.equal(view.code, 1, 'the existing status channel is untouched');
  assert.equal(view.startedAt, '2026-09-01T04:00:00.000Z');
});

test('#1728: a successful status (code 0) with no marker seeds nothing, as before', () => {
  const root = freshRoot();
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  fs.writeFileSync(statusPath(root), '0 2026-09-01T04:00:00.000Z\n');

  assert.equal(update.lastAttempt(), null, 'success is the board coming back changed, not a record');
});

test('#1728 WARNING fix: a success killed before rm (SAME-attempt marker) does NOT read as interrupted', () => {
  // The shell wrote a code-0 status, then the board was killed in the tiny window
  // before `rm -f "$4"`. The marker survives but the attempt DID finish -- it must
  // not be reported as interrupted (same start stamp => same, finished attempt).
  const root = freshRoot();
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  const startedAt = '2026-09-01T05:00:00.000Z';
  fs.writeFileSync(statusPath(root), '0 ' + startedAt + '\n');
  fs.writeFileSync(startedPath(root), startedAt + '\n'); // same-attempt residue
  assert.equal(update.lastAttempt(), null, 'a finished (successful) attempt is never reported as interrupted');
});

test('#1728 CONTROL: a marker from a LATER attempt than an older SUCCESS is a genuine interruption', () => {
  // The suppression is same-attempt only: a newer marker after an older success
  // is a real later interruption and must still surface (proves suppression is
  // keyed on the start stamp, not "any success suppresses any marker").
  const root = freshRoot();
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  fs.writeFileSync(statusPath(root), '0 2026-09-01T04:00:00.000Z\n'); // older successful attempt
  fs.writeFileSync(startedPath(root), '2026-09-01T05:00:00.000Z\n');   // newer attempt, interrupted
  const view = update.lastAttempt();
  assert.ok(view, 'a newer interrupted attempt after an older success is reported');
  assert.equal(view.startedAt, '2026-09-01T05:00:00.000Z');
  assert.equal(view.code, null);
  assert.match(view.because, /interrupted/i);
});

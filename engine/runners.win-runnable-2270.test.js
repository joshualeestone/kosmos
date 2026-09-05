'use strict';
/* #2270: on win32 `fs.accessSync(p, X_OK)` is a no-op (behaves as F_OK), so
 * runnableExactly accepted any file that merely exists - a plain extensionless
 * `claude` read as a launchable runner. On Windows executability is the
 * EXTENSION (PATHEXT). runnableExactly now branches: win32 -> the extension is
 * in PATHEXT; POSIX -> X_OK (unchanged).
 *
 * The platform is injectable (as it is on pathextCandidates, #570) so the win32
 * branch is testable from the POSIX box CI runs on. The discriminating cases
 * below are RED-CAPABLE on that host: a 0o755 file with NO extension is
 * X_OK-true but ext-false, and a 0o644 `.exe` is X_OK-false but ext-true - so
 * each isolates the branch that changed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runnableExactly } = require('./runners');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-win-runnable-'));
test.after(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

function file(name, mode) {
  const p = path.join(DIR, name);
  fs.writeFileSync(p, 'x');
  fs.chmodSync(p, mode);
  return p;
}

test('#2270: on win32, executability is the EXTENSION, not the exec bit', () => {
  // A real executable (0o755) with NO extension: launchable on POSIX, NOT a
  // runner on Windows (the loader needs a PATHEXT suffix). This is the exact
  // case the old X_OK-only code got wrong on win32.
  const execNoExt = file('claude', 0o755);
  assert.equal(runnableExactly(execNoExt, 'win32'), false,
    'win32 must reject an extensionless file even with the exec bit set (X_OK is a no-op there)');
  assert.equal(runnableExactly(execNoExt, 'darwin'), true,
    'POSIX control: the same 0o755 file IS runnable by X_OK');

  // A 0o644 `.exe`: NOT X_OK-executable, but Windows launches it by extension.
  const exe644 = file('claude.exe', 0o644);
  assert.equal(runnableExactly(exe644, 'win32'), true,
    'win32 must accept a .exe by its extension regardless of the (meaningless-there) mode bit');
  assert.equal(runnableExactly(exe644, 'darwin'), false,
    'POSIX control: a 0o644 file is not runnable, .exe or not');
});

test('#2270: win32 honours PATHEXT (env-aware), and a directory is never runnable', () => {
  const bat = file('run.bat', 0o644);
  const exe = file('run2.exe', 0o644);
  // With a PATHEXT of only .BAT, a .bat is runnable and a .exe is not.
  assert.equal(runnableExactly(bat, 'win32', { PATHEXT: '.BAT' }), true, '.bat is in this PATHEXT');
  assert.equal(runnableExactly(exe, 'win32', { PATHEXT: '.BAT' }), false, '.exe is NOT in a PATHEXT of just .BAT');
  // Case-insensitive, like Windows.
  assert.equal(runnableExactly(file('run3.EXE', 0o644), 'win32', { PATHEXT: '.exe' }), true, 'PATHEXT match is case-insensitive');

  const dir = path.join(DIR, 'adir');
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(runnableExactly(dir, 'win32'), false, 'a directory is never runnable (isFile guards it on every platform)');
  assert.equal(runnableExactly(path.join(DIR, 'nope.exe'), 'win32'), false, 'a missing file is not runnable');
});

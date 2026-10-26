'use strict';
/**
 * #7247: keep a test run on a Windows computer away from its real Task Scheduler.
 *
 * Kosmos keeps its board, its agents and its listeners on Windows as scheduled tasks, and reaches the scheduler only
 * through schtasks.exe. Many tests drive that code without a seam, so a suite run on a Windows box fires thousands of
 * real schtasks calls (measured on the Windows box), and one could create, change or end a live task.
 *
 * Loaded with --require, through NODE_OPTIONS so every test subprocess inherits it: any child_process call that names
 * schtasks is refused as if schtasks.exe were missing (ENOENT), and logged to KOSMOS_SCHTASKS_BLOCK_LOG when that is set.
 * tools/windows-tests.js and tools/run-tests.sh load it on a Windows computer by themselves, except on CI (a throwaway
 * runner, where the real scheduler is what the Windows job measures) and when KOSMOS_TESTS_REAL_SCHTASKS=1 asks for the
 * real one. Everything else passes through unchanged.
 */
const cp = require('node:child_process');
const fs = require('node:fs');

const LOG = process.env.KOSMOS_SCHTASKS_BLOCK_LOG;
const SCHTASKS = /(^|[\\/"'\s])schtasks(\.exe)?(["'\s]|$)/i;

/* Whether a call names schtasks: as the program, in its argument list (cmd /c schtasks ...), or in a shell command. */
function names(file, rest) {
  const first = rest && rest[0];
  const args = Array.isArray(first) ? first.join(' ') : '';
  return SCHTASKS.test(' ' + String(file == null ? '' : file) + ' ' + args + ' ');
}
function note(what) {
  try {
    if (LOG) fs.appendFileSync(LOG, new Date().toISOString() + ' pid=' + process.pid + ' argv=' + process.argv.slice(1).join(' ') + ' ' + what + '\n');
  } catch { /* logging must never change a result */ }
}
function blocked() {
  const e = new Error('spawnSync schtasks.exe ENOENT (blocked by the test suite preload, #7247)');
  e.code = 'ENOENT'; e.errno = -4058; e.stdout = ''; e.stderr = ''; e.status = null;
  return e;
}
const real = { ...cp };
/* What an asynchronous call returns when refused: a real child that exits 1 at once, so callers that wait on its events
   still get them. */
const inert = () => real.spawn(process.execPath, ['-e', 'process.exit(1)'], { stdio: 'ignore' });

cp.execFileSync = function (file, ...rest) {
  if (names(file, rest)) { note('execFileSync ' + file + ' ' + JSON.stringify(rest[0] || [])); throw blocked(); }
  return real.execFileSync.call(this, file, ...rest);
};
cp.spawnSync = function (file, ...rest) {
  if (names(file, rest)) {
    note('spawnSync ' + file + ' ' + JSON.stringify(rest[0] || []));
    return { pid: 0, output: [null, '', ''], stdout: '', stderr: '', status: null, signal: null, error: blocked() };
  }
  return real.spawnSync.call(this, file, ...rest);
};
cp.execSync = function (cmd, ...rest) {
  if (names(cmd, [])) { note('execSync ' + cmd); throw blocked(); }
  return real.execSync.call(this, cmd, ...rest);
};
cp.execFile = function (file, ...rest) {
  if (names(file, rest)) {
    note('execFile ' + file + ' ' + JSON.stringify(Array.isArray(rest[0]) ? rest[0] : []));
    const cb = rest.find((x) => typeof x === 'function');
    if (cb) process.nextTick(() => cb(blocked(), '', ''));
    return inert();
  }
  return real.execFile.call(this, file, ...rest);
};
cp.exec = function (cmd, ...rest) {
  if (names(cmd, [])) {
    note('exec ' + cmd);
    const cb = rest.find((x) => typeof x === 'function');
    if (cb) process.nextTick(() => cb(blocked(), '', ''));
    return inert();
  }
  return real.exec.call(this, cmd, ...rest);
};
cp.spawn = function (file, ...rest) {
  if (names(file, rest)) { note('spawn ' + file + ' ' + JSON.stringify(Array.isArray(rest[0]) ? rest[0] : [])); return inert(); }
  return real.spawn.call(this, file, ...rest);
};

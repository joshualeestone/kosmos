'use strict';
/**
 * #7247: keep a test run on a Windows computer away from its real Task Scheduler.
 *
 * Kosmos keeps its board, its agents and its listeners on Windows as scheduled tasks, and reaches the scheduler only
 * through schtasks.exe. Most tests stub those calls, but one that does not would run against the computer's live
 * tasks, where it could end the board's own task. This guard costs nothing when nothing calls schtasks.
 *
 * Loaded with --require, through NODE_OPTIONS so every test subprocess inherits it: every one that keeps
 * NODE_OPTIONS. A process started with an environment of its own that replaces NODE_OPTIONS or leaves it out (some
 * tests do, and engine/manifest-verify.js strips it on purpose) runs unguarded, and so does everything it starts. This
 * guard does not put itself back there: those callers set NODE_OPTIONS deliberately and tests check that they do.
 * A child_process call that RUNS
 * schtasks (tools/lib/schtasks-call.cjs decides) is sent, with no shell, to a program that cannot exist,
 * REFUSED_PROGRAM, so it fails with Node's own ENOENT: the sync calls throw or return it, the async ones emit 'error'
 * (with their streams) and call back with it, and promisify rejects with it. For spawn and execFile that is exactly
 * what a missing schtasks.exe gives. For exec and execSync it is not quite: a shell that cannot find a command exits
 * with a status instead (cmd 1, sh 127), while a refused one fails with ENOENT and no status.
 * Every other call goes to Node unchanged, promisify included (the wrappers carry util.promisify.custom, as
 * test-support/tool-guard.js does). KOSMOS_SCHTASKS_BLOCK_LOG names a file that logs each refused call, with the
 * test's argv and the refused command line (task names included).
 *
 * tools/windows-tests.js and tools/run-tests.sh load it on a Windows computer by themselves, except on CI and when
 * KOSMOS_TESTS_REAL_SCHTASKS=1 asks for the real scheduler (tools/windows-tests.js guardsScheduler holds the rule).
 */
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
const { callRuns, commandRuns } = require(path.join(__dirname, 'lib', 'schtasks-call.cjs'));

/* The name a refused call runs instead: it names the refusal in the ENOENT message, and no computer has it. */
const REFUSED_PROGRAM = 'schtasks-refused-by-the-kosmos-test-preload-7247';
const LOG = process.env.KOSMOS_SCHTASKS_BLOCK_LOG;

function note(how, what) {
  try {
    if (LOG) fs.appendFileSync(LOG, new Date().toISOString() + ' pid=' + process.pid + ' argv=' + process.argv.slice(1).join(' ') + ' ' + how + ' ' + what + '\n');
  } catch { /* logging must never change a result */ }
}

/* (args?, options?, callback?) after the program, as Node reads them: an array, or a null or undefined in its place,
   is the args; then an object is the options. */
function split(rest) {
  const hasArgs = Array.isArray(rest[0]) || (rest.length > 1 && rest[0] == null);
  const args = Array.isArray(rest[0]) ? rest[0] : null;
  return { args, ...optionsThenTail(hasArgs ? rest.slice(1) : rest) };
}
/* (options?, callback?), the part every call shares. A null or undefined in the options slot with a callback after
   it is still the options slot (Node moves past it), so the callback is kept (review 3: execFile(file, args, null,
   cb) lost cb when refused). */
function optionsThenTail(after) {
  const options = after[0] && typeof after[0] === 'object' ? after[0] : null;
  const slot = options || (after[0] == null && after.length > 1);
  return { options, tail: slot ? after.slice(1) : after };
}
/* The same call aimed at REFUSED_PROGRAM, with no shell, so it fails as a missing program rather than as a shell
   that could not find a command. */
function refused(parts) {
  return [REFUSED_PROGRAM, parts.args || [], { ...(parts.options || {}), shell: false }, ...parts.tail];
}

const real = { ...cp };
/* A wrapper for a call that names its program (spawn, spawnSync, execFile, execFileSync), and its refused form
   through `run` (the real function, or the real promisified one). */
function programCall(name, run) {
  return function (file, ...rest) {
    const parts = split(rest);
    if (!callRuns(file, parts.args, parts.options)) return run.call(this, file, ...rest);
    note(name, file + ' ' + JSON.stringify(parts.args || []));
    return run.call(this, ...refused(parts));
  };
}
/* A wrapper for a shell command line (exec, execSync): (command, options?, callback?). Refused, it runs as the file
   form of the same call, so there is no shell to report a status. */
function shellCall(name, run, refusedRun) {
  return function (command, ...rest) {
    if (!commandRuns(command)) return run.call(this, command, ...rest);
    note(name, String(command));
    return refusedRun.call(this, ...refused({ args: null, ...optionsThenTail(rest) }));
  };
}

const wrap = {
  execFileSync: programCall('execFileSync', real.execFileSync),
  spawnSync: programCall('spawnSync', real.spawnSync),
  spawn: programCall('spawn', real.spawn),
  execFile: programCall('execFile', real.execFile),
  execSync: shellCall('execSync', real.execSync, real.execFileSync),
  exec: shellCall('exec', real.exec, real.execFile),
};
/* promisify(execFile) and promisify(exec) resolve { stdout, stderr } through Node's own custom form. A wrapper
   without it would make promisify fall back to its generic form and resolve a bare string (#4326 hit this). */
wrap.execFile[util.promisify.custom] = programCall('execFile(promisified)', real.execFile[util.promisify.custom]);
wrap.exec[util.promisify.custom] = shellCall('exec(promisified)', real.exec[util.promisify.custom], real.execFile[util.promisify.custom]);
Object.assign(cp, wrap);

module.exports = { REFUSED_PROGRAM };

'use strict';
/**
 * #7247: keep a test run on a Windows computer away from its real Task Scheduler.
 *
 * Kosmos keeps its board, its agents and its listeners on Windows as scheduled tasks, and reaches the scheduler only
 * through schtasks.exe. Most tests stub those calls, but one that does not would run against the computer's live
 * tasks, where it could end the board's own task. This guard costs nothing when nothing calls schtasks.
 *
 * Loaded with --require, through NODE_OPTIONS so every test subprocess inherits it. A child_process call that RUNS
 * schtasks (tools/lib/schtasks-call.cjs decides) is sent to a program that cannot exist, REFUSED_PROGRAM, so every
 * arm fails exactly as a missing schtasks.exe would, with Node's own ENOENT: the sync calls throw or return it, the
 * async ones emit 'error' and call back with it, and promisify(execFile) rejects with it. Every other call goes to
 * Node unchanged, promisify included (the wrappers carry util.promisify.custom, as test-support/tool-guard.js does).
 * KOSMOS_SCHTASKS_BLOCK_LOG names a file that logs each refused call.
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

/* (file, args?, options?, callback?) as Node reads it: args only when it is an array, options only when an object. */
function split(rest) {
  const args = Array.isArray(rest[0]) ? rest[0] : null;
  const after = args ? rest.slice(1) : rest;
  const options = after[0] && typeof after[0] === 'object' ? after[0] : null;
  return { args, options, tail: options ? after.slice(1) : after };
}
/* The same call aimed at REFUSED_PROGRAM, with no shell, so it fails as a missing program rather than as a shell
   that could not find a command. */
function refused(rest) {
  const { args, options, tail } = split(rest);
  return [REFUSED_PROGRAM, args || [], { ...(options || {}), shell: false }, ...tail];
}

const real = { ...cp };
const wrap = {
  execFileSync(file, ...rest) {
    if (!callRuns(file, split(rest).args, split(rest).options)) return real.execFileSync.call(this, file, ...rest);
    note('execFileSync', file + ' ' + JSON.stringify(split(rest).args || []));
    return real.execFileSync.call(this, ...refused(rest));
  },
  spawnSync(file, ...rest) {
    if (!callRuns(file, split(rest).args, split(rest).options)) return real.spawnSync.call(this, file, ...rest);
    note('spawnSync', file + ' ' + JSON.stringify(split(rest).args || []));
    return real.spawnSync.call(this, ...refused(rest));
  },
  spawn(file, ...rest) {
    if (!callRuns(file, split(rest).args, split(rest).options)) return real.spawn.call(this, file, ...rest);
    note('spawn', file + ' ' + JSON.stringify(split(rest).args || []));
    return real.spawn.call(this, ...refused(rest));
  },
  execFile(file, ...rest) {
    if (!callRuns(file, split(rest).args, split(rest).options)) return real.execFile.call(this, file, ...rest);
    note('execFile', file + ' ' + JSON.stringify(split(rest).args || []));
    return real.execFile.call(this, ...refused(rest));
  },
  /* exec and execSync take one shell command line: (command, options?, callback?). */
  execSync(command, ...rest) {
    if (!commandRuns(command)) return real.execSync.call(this, command, ...rest);
    note('execSync', command);
    return real.execFileSync.call(this, ...refused(rest));
  },
  exec(command, ...rest) {
    if (!commandRuns(command)) return real.exec.call(this, command, ...rest);
    note('exec', command);
    return real.execFile.call(this, ...refused(rest));
  },
};
/* promisify(execFile) and promisify(exec) resolve { stdout, stderr } through Node's own custom form. A wrapper
   without it would make promisify fall back to its generic form and resolve a bare string (#4326 hit this). */
wrap.execFile[util.promisify.custom] = (file, ...rest) => {
  if (!callRuns(file, split(rest).args, split(rest).options)) return real.execFile[util.promisify.custom](file, ...rest);
  note('execFile(promisified)', file + ' ' + JSON.stringify(split(rest).args || []));
  return real.execFile[util.promisify.custom](...refused(rest));
};
wrap.exec[util.promisify.custom] = (command, ...rest) => {
  if (!commandRuns(command)) return real.exec[util.promisify.custom](command, ...rest);
  note('exec(promisified)', command);
  return real.execFile[util.promisify.custom](...refused(rest));
};
Object.assign(cp, wrap);

module.exports = { REFUSED_PROGRAM };

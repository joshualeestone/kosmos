'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9278: on Windows (Git Bash), tools/run-tests.sh points TEMP and TMP at the run's temp root as well as TMPDIR,
 * because node there takes os.tmpdir() from TEMP/TMP (measured on a Windows runner: without it a test saw the computer's
 * own temp folder, and the temp leak check caught nothing; with it, a folder left behind was reported). It also says
 * once that the leftover-process checks do not run there (the per-file limit does since winwd-9278: rt_wd_loop_win). Both are behind the Windows flag only,
 * so a Mac or Linux run is unchanged: the lines are cut out of the script and run with the flag set and not set.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SRC = fs.readFileSync(path.join(__dirname, 'tools', 'run-tests.sh'), 'utf8');
const BASH = spawnSync('bash', ['--version']).status === 0;

function line(re) {
  const hits = SRC.split('\n').filter((l) => re.test(l));
  assert.equal(hits.length, 1, 'expected exactly one line matching ' + re);
  return hits[0];
}
const TEMP_LINE = line(/export TEMP="\$KOSMOS_RUN_TMPDIR" TMP="\$KOSMOS_RUN_TMPDIR"/);
const SAY_LINE = line(/on Windows the leftover-process checks and stops \(#4273, #8890, #9159\) do not run/);

function runWith(win, body) {
  const script = '_RT_WIN=' + win + '; KOSMOS_RUN_TMPDIR=/run/root; TEMP=/orig; TMP=/orig\n' + body
    + '\nprintf "TEMP=%s TMP=%s\\n" "$TEMP" "$TMP"';
  return spawnSync('bash', ['-c', script], { encoding: 'utf8' });
}

test('#9278: on Windows TEMP and TMP follow the run root', { skip: !BASH && 'no bash' }, () => {
  const r = runWith(1, TEMP_LINE);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /TEMP=\/run\/root TMP=\/run\/root/);
});

test('#9278 CONTROL: off Windows TEMP and TMP are left as they were', { skip: !BASH && 'no bash' }, () => {
  const r = runWith(0, TEMP_LINE);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /TEMP=\/orig TMP=\/orig/);
});

test('#9278: the TEMP line sits right after the TMPDIR export, in the branch that made the run root', () => {
  const i = SRC.indexOf('  export TMPDIR="$KOSMOS_RUN_TMPDIR"\n');
  assert.ok(i >= 0, 'the TMPDIR export moved');
  const j = SRC.indexOf(TEMP_LINE, i);
  assert.ok(j > i && j - i < 600, 'the TEMP and TMP export is not just after the TMPDIR export');
  assert.ok(SRC.indexOf('\n_RT_WIN=0 ') >= 0 && SRC.indexOf('\n_RT_WIN=0 ') < i, 'the Windows flag must be set before the run root is made');
});

test('#9278: the Windows line is said only on Windows, once, from the watchdog start', { skip: !BASH && 'no bash' }, () => {
  const on = runWith(1, SAY_LINE);
  assert.match(on.stderr, /^run-tests: on Windows the leftover-process checks and stops .* \(kosmos#9278\)\n$/);
  const off = runWith(0, SAY_LINE);
  assert.equal(off.stderr, '', 'a Mac or Linux run printed the Windows line');
  const fn = SRC.slice(SRC.indexOf('rt_file_watchdog_start() {'), SRC.indexOf('\n}\n', SRC.indexOf('rt_file_watchdog_start() {')));
  assert.ok(fn.includes(SAY_LINE), 'the line is not inside rt_file_watchdog_start');
  assert.ok(fn.indexOf('[ "$KOSMOS_TEST_PART" != shell ] || return 0') < fn.indexOf(SAY_LINE), 'a shell-only run (no node) would say it');
});

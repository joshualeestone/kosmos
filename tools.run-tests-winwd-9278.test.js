'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9278: the per-file watchdog on Windows. Under Git Bash there is no pgrep and ps cannot list Windows processes,
 * so tools/run-tests.sh runs rt_wd_loop_win there instead of rt_wd_loop: node --test from /proc, its per-file children
 * from one Windows snapshot, a file over the limit stopped with taskkill /T /F. The Windows arm runs the real runner on
 * a file stuck in a sync call, on the Windows CI job (ALSO_ROOT in tools/windows-tests.js). Off Windows the Mac loop
 * is the one under test in tools.run-tests-file-timeout-6668.test.js, and this file checks only that it is still the
 * one started there.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RUNNER = path.join(__dirname, 'tools', 'run-tests.sh');
const SRC = fs.readFileSync(RUNNER, 'utf8');
const WIN = process.platform === 'win32';

test('#9278: the Windows loop is started only on Windows, and the Mac loop everywhere else', () => {
  const start = SRC.slice(SRC.indexOf('rt_file_watchdog_start() {'));
  const line = start.split('\n').find((l) => l.includes('rt_wd_loop_win "$$"'));
  assert.ok(line, 'rt_file_watchdog_start no longer starts rt_wd_loop_win');
  assert.match(line, /^\s*if \[ "\$_RT_WIN" = 1 \]; then rt_wd_loop_win "\$\$" "\$_rt_wd_flag" & else rt_wd_loop "\$\$" "\$_rt_wd_flag" & fi$/);
  assert.match(SRC, /\nrt_wd_loop_win\(\) \{\n/, 'rt_wd_loop_win is not defined');
  assert.match(SRC, /\n_RT_WIN=0 [^\n]*\ncase "\$\(uname -s/, 'the Windows flag must be reset before the uname case');
});

/* The runner as the Windows CI job would run it, inside this test: without its own NODE_TEST_CONTEXT dropped, the inner
   node --test reports to this one and exits 0 (measured on the Windows runner: a stopped file and a green run), so it
   is dropped with the runner's other settings, as tools.run-tests-file-timeout-6668 does. */
function runRunner(files, timeoutMs) {
  const env = { ...process.env };
  for (const k of ['NODE_TEST_CONTEXT', 'KOSMOS_TEST_PART', 'KOSMOS_TEST_PART_LOCAL', 'KOSMOS_SHELL_SHARD', 'KOSMOS_SHELL_PLATFORM',
    'KOSMOS_TEST_FILE_TIMEOUT_MIN', 'KOSMOS_TEST_TIMEOUT_MS', 'KOSMOS_RT_STOP_OWN_NODE', 'KOSMOS_MACHINE_CLAIM_COOKIE',
    'KOSMOS_LIGHT_SIDE_COOKIE']) delete env[k];
  Object.assign(env, { KOSMOS_TEST_FILE_TIMEOUT_S: '30', KOSMOS_WINWD_9278_INNER: '1', KOSMOS_IGNORE_MACHINE_CLAIM: '1', KOSMOS_TESTS_IGNORE_HARNESS: '1' });
  const started = Date.now();
  const r = spawnSync('bash', [RUNNER, '--only', ...files], { env, encoding: 'utf8', timeout: timeoutMs });
  return { r, took: Date.now() - started, out: (r.stdout || '') + (r.stderr || '') };
}
const HANG_SRC = "require('node:test')('blocks', () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 600000); });\n";
const QUICK_SRC = "require('node:test')('ends', () => {});\n";
const SKIP_OFF_WIN = !WIN && 'the real Windows watchdog runs only on Windows; off Windows it is tools.run-tests-file-timeout-6668';

test('#9278: on Windows a file stuck in a sync call is stopped at the limit, named, and the run is red', { skip: SKIP_OFF_WIN }, () => {
  if (process.env.KOSMOS_WINWD_9278_INNER === '1') return;   // a run this file starts never runs this file again
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'winwd9278-'));
  const hang = path.join(dir, 'hang.test.js');
  const quick = path.join(dir, 'quick.test.js');
  fs.writeFileSync(hang, HANG_SRC);
  fs.writeFileSync(quick, QUICK_SRC);
  const { r, took, out } = runRunner([hang, quick], 240000);
  assert.ok(!(r.error && r.error.code === 'ETIMEDOUT'), 'the runner was not stopped by its own watchdog: ' + out.slice(-1500));
  assert.notEqual(r.status, 0, 'a run with a stopped file must be red: ' + out.slice(-1500));
  assert.match(out, /run-tests: TIMED OUT after 30 s: \S*hang\.test\.js \(#6668/, 'the hung file was not named');
  assert.doesNotMatch(out, /TIMED OUT after 30 s: \S*quick\.test\.js/, 'the file that ended was named too');
  assert.ok(took < 150000, 'stopped at ' + took + ' ms, far past a 30 s limit');
  console.log('MEASURED: stopped after ' + took + ' ms with a 30 s limit');
});

/* challenge iteration 1 BLOCKER: on Windows node --test runs once per #7257 chunk, so a watchdog that ended with the
   first chunk's node left every later chunk without a limit. Enough long-named quick files to need two chunks, and
   the stuck file last, in the second. */
test('#9278: on Windows a stuck file in a LATER chunk is still stopped (the watchdog follows each chunk)', { skip: SKIP_OFF_WIN }, () => {
  if (process.env.KOSMOS_WINWD_9278_INNER === '1') return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'winwd9278c-'));
  const files = [];
  for (let n = 0; files.join(' ').length < 30000; n += 1) {
    const f = path.join(dir, 'q' + String(n).padStart(4, '0') + '-' + 'x'.repeat(180) + '.test.js');
    fs.writeFileSync(f, QUICK_SRC);
    files.push(f);
  }
  const hang = path.join(dir, 'zz-hang.test.js');
  fs.writeFileSync(hang, HANG_SRC);
  files.push(hang);
  const { r, took, out } = runRunner(files, 420000);
  assert.match(out, /run-tests: node --test ran in ([2-9]|\d\d+) chunk\(s\)/, 'the fixture did not make two chunks, so this arm tested nothing: ' + out.slice(-800));
  assert.ok(!(r.error && r.error.code === 'ETIMEDOUT'), 'the stuck file in a later chunk was not stopped: ' + out.slice(-1500));
  assert.notEqual(r.status, 0, 'a run with a stopped file must be red: ' + out.slice(-1500));
  assert.match(out, /run-tests: TIMED OUT after 30 s: \S*zz-hang\.test\.js \(#6668/, 'the stuck file in the later chunk was not named');
  console.log('MEASURED: ' + files.length + ' files, stopped after ' + took + ' ms');
});

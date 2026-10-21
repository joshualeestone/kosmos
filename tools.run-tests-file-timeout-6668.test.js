'use strict';

/**
 * #6668: tools/run-tests.sh stops any one test FILE that runs longer than its limit, from OUTSIDE node, so a test
 * blocked in a sync call (which --test-timeout cannot interrupt) costs the limit and a red, not the machine's queue.
 *
 * Each arm runs the real runner with --only on a fixture written OUTSIDE the repo (a *.test.js inside it would change
 * the whole-suite count), with the limit set to a few seconds through KOSMOS_TEST_FILE_TIMEOUT_S.
 *
 *   node --test tools.run-tests-file-timeout-6668.test.js
 */
require('./test-support/tmpscope');
const test = require('node:test');
/* A run this file starts must never start this file again (the same stand-down as tools.run-tests-only-4929). */
if (process.env.KOSMOS_FILE_TIMEOUT_6668_INNER === '1') {
  test('stands down inside its own inner run', { skip: 'started by tools.run-tests-file-timeout-6668.test.js itself' }, () => {});
  return;
}
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const RUNNER = path.join(__dirname, 'tools', 'run-tests.sh');
const RUNNER_SRC = fs.readFileSync(RUNNER, 'utf8');
/* Read, never run, to see whether this runner knows --only: running one that does not starts the whole suite. */
const KNOWS_ONLY = /\[ "\$\{1:-\}" = --only \]/.test(RUNNER_SRC);
const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'filetimeout-6668-')));
test.after(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ } });
/* What run-tests.sh exports, or what a queue turn or node --test hands down: none of it may reach the inner runs. */
const RUNNER_SET = ['AGENT_WORKFORCE_CREATED_URL', 'AGENT_WORKFORCE_FEEDBACK_URL', 'AGENT_WORKFORCE_COMMUNITY_URL',
  'KOSMOS_CATALOGUE_BASE', 'AGENT_WORKFORCE_GH_BIN', 'AGENT_WORKFORCE_VERCEL_BIN', 'KOSMOS_NO_LEGACY_MIGRATION',
  'KOSMOS_TEST_PART', 'KOSMOS_TEST_PART_LOCAL', 'KOSMOS_SHELL_SHARD', 'KOSMOS_SHELL_PLATFORM', 'KOSMOS_MACHINE_CLAIM_COOKIE',
  'KOSMOS_LIGHT_SIDE_COOKIE', 'NODE_TEST_CONTEXT', 'KOSMOS_TEST_FILE_TIMEOUT_MIN', 'KOSMOS_TEST_FILE_TIMEOUT_S',
  'KOSMOS_TEST_TIMEOUT_MS',
  'TMUX', 'TMUX_PANE'];
const PLAIN_TMP = fs.mkdtempSync(path.join(DIR, 'tmp-'));
const SANDBOX_HOME = fs.mkdtempSync(path.join(DIR, 'home-'));
function env(extra) {
  const e = { ...process.env };
  for (const k of RUNNER_SET) delete e[k];
  // A sandbox HOME, so the inner run's #3011 check reads an empty LaunchAgents folder; a plain TMPDIR for its root.
  Object.assign(e, { TMPDIR: PLAIN_TMP, HOME: SANDBOX_HOME, KOSMOS_FILE_TIMEOUT_6668_INNER: '1',
    KOSMOS_IGNORE_MACHINE_CLAIM: '1', KOSMOS_TESTS_IGNORE_HARNESS: '1' });
  return { ...e, ...extra };
}

/* The runner starts in its own process group under a small perl parent, and this test's hard timeout TERMs the whole
   group. So a broken watchdog costs this test HARD_MS and a red, never a sleep 600 left holding the queue. */
const GROUP = 'my $pid; $SIG{TERM} = sub { $SIG{TERM} = "IGNORE"; kill "TERM", -$$; exit 143 }; setpgrp(0, 0); ' +
  '$pid = fork; die "fork: $!" unless defined $pid; if (!$pid) { exec @ARGV or exit 127 } ' +
  'waitpid($pid, 0); exit(($? & 127) ? 128 + ($? & 127) : $? >> 8)';
const { scaleBudget } = require('./test-support/eventually');
/* Liveness ceilings, scaled by the run's KOSMOS_TEST_TIME_SCALE so a loaded box cannot redden a correct runner. */
/* HANG_S: the hang arms' limit. It must outlast node's start, both preloads and the fixture writing its pids, or a
   loaded box stops the file before it has recorded them and the arm fails for the wrong reason: a 10 s start-up
   allowance, scaled. */
const HANG_S = Math.ceil(scaleBudget(10000) / 1000);
/* The runner's own label for a limit in seconds: whole minutes say min. */
const LABEL = (sec) => (sec % 60 === 0 ? `${sec / 60} min` : `${sec} s`);
/* STOP_MS: the liveness ceiling for a timed-out file's whole run. The mechanism needs the HANG_S limit + up to 5 s of
   TERM grace + 2 watchdog ticks (1 s under a 30 s limit, else 5 s); 6x that is headroom for the inner runner's own
   start and finish on a loaded box (one took 46 s at load 32). It asserts the file was stopped, not how fast. HARD_MS,
   the spawn's own timeout, stays well above it so a slow but working run reads as slow, and a broken watchdog as hung. */
const TICK_MS = HANG_S < 30 ? 1000 : 5000;
const STOP_MS = 6 * (HANG_S * 1000 + scaleBudget(5000 + 2 * TICK_MS));
const HARD_MS = scaleBudget(240000);
function run(args, extra) {
  assert.ok(KNOWS_ONLY, 'tools/run-tests.sh has no --only: not running it, since it would run the whole suite');
  const started = Date.now();
  const r = spawnSync('perl', ['-e', GROUP, 'bash', RUNNER, ...args], { env: env(extra), encoding: 'utf8', timeout: HARD_MS });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), ms: Date.now() - started, timedOut: !!(r.error && r.error.code === 'ETIMEDOUT') };
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/* A file blocked in spawnSync, the #6668 shape: node's own --test-timeout cannot reach it. It writes its own pid and,
   through the shell, the pid of the sleep it blocks on (exec keeps the shell's pid), so the arm can prove that
   nothing it started is left. */
const PIDS = path.join(DIR, 'hang.pids');
function hangFixture(name, ignoreTerm) {
  const f = path.join(DIR, name);
  /* ignoreTerm: both the file and its sleep ignore TERM (a handler node cannot run while blocked; an ignored signal
     survives exec), so only the KILL that follows can stop them. */
  fs.writeFileSync(f, `'use strict';
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
${ignoreTerm ? "process.on('SIGTERM', () => {});" : ''}
require('node:test')('blocks in spawnSync', () => {
  fs.appendFileSync(${JSON.stringify(PIDS)}, process.pid + '\\n');
  spawnSync('sh', ['-c', '${ignoreTerm ? 'trap \\"\\" TERM; ' : ''}echo $$ >> "$1"; exec sleep 600', 'sh', ${JSON.stringify(PIDS)}]);
});
`);
  return f;
}
const HANG = hangFixture('hang.test.js', false);
const STUBBORN = hangFixture('stubborn.test.js', true);
/* The control: a file that runs QUICK_MS (4 s, scaled), several watchdog ticks, under its limit. Both scale with
   KOSMOS_TEST_TIME_SCALE, so a loaded suite cannot push the file past its limit; the file scales too, so at a larger
   limit (5 s ticks from 30 s up) the watchdog still looks at it several times and a zero limit still reddens this
   control. A shorter file can finish before the watchdog has looked at it once. */
const QUICK_MS = scaleBudget(4000);
/* The watchdog counts node's start and both preloads in a file's age, so the limit is the file's own time plus a
   start-up allowance, both scaled (not a multiple of the file's time). */
const QUICK_LIMIT_S = String(Math.ceil((QUICK_MS + scaleBudget(10000)) / 1000));
const QUICK = path.join(DIR, 'quick.test.js');
fs.writeFileSync(QUICK, `'use strict';
require('node:test')('runs a few seconds', () => new Promise((r) => setTimeout(r, ${QUICK_MS})));
`);

function fixturePids() {
  try { return fs.readFileSync(PIDS, 'utf8').trim().split('\n').filter(Boolean).map(Number); } catch { return []; }
}
function timesOut(file, { also = [], extra = {} } = {}) {
  fs.rmSync(PIDS, { force: true });
  let passed = false;
  try {
    const r = run(['--only', file, ...also], { KOSMOS_TEST_FILE_TIMEOUT_S: String(HANG_S), ...extra });
    assert.equal(r.timedOut, false, `the runner was still running after ${HARD_MS} ms: the watchdog did not stop the file`);
    assert.match(r.out, new RegExp('run-tests: TIMED OUT after ' + LABEL(HANG_S) + ': ' + file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' '),
      'no TIMED OUT line naming the file: ' + r.out.slice(-1500));
    assert.ok(r.out.includes('1 test file(s) ran longer than ' + LABEL(HANG_S) + ' and were stopped'), r.out.slice(-800));
    assert.notEqual(r.code, 0, 'a timed-out file must make the run red');
    assert.ok(r.ms < STOP_MS, `took ${r.ms} ms, over the ${STOP_MS} ms ceiling for a ${HANG_S} s limit: the file was not stopped near it`);
    const pids = fixturePids();
    assert.equal(pids.length, 2, 'the fixture did not record its node and its sleep: ' + pids.join(','));
    const deadline = Date.now() + scaleBudget(3000);
    while (pids.some(alive) && Date.now() < deadline) spawnSync('sleep', ['0.2']);
    const left = pids.filter(alive);
    assert.deepEqual(left, [], 'a process the timed-out file started is still running: SURVIVORS ' + left.join(' '));
    passed = true;
  } finally {
    // On a red, nothing this fixture started outlives the test (the TERM-ignoring one survives the hard timeout's
    // TERM). Only the pids the fixture itself wrote, and only those still alive; never on a green, where they are
    // gone and a pid may already be someone else's.
    if (!passed) for (const pid of fixturePids().filter(alive)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  }
}

test('#6668 a file blocked in spawnSync is stopped at the limit, named, red, and leaves nothing running', () => {
  timesOut(HANG);
});

test('#6668 a file and child that ignore TERM are KILLed', () => {
  timesOut(STUBBORN);
});

/* A non-exec node shim (Volta and similar), first on the inner runner's PATH: it starts the real node as a CHILD and
   waits, so the runner's child reads as node --test while the real node --test (and every file) sits one level down.
   It records each start, so the arm can prove the shim was really in the path. */
const SHIM_DIR = fs.mkdtempSync(path.join(DIR, 'shim-'));
const SHIM_LOG = path.join(DIR, 'shim.log');
fs.writeFileSync(path.join(SHIM_DIR, 'node'), `#!/bin/bash
echo "$$ $*" >> ${JSON.stringify(SHIM_LOG)}
${JSON.stringify(process.execPath)} "$@" &
c=$!
trap 'kill -TERM "$c" 2>/dev/null' TERM INT
wait "$c"
`, { mode: 0o755 });
const shimEnv = () => ({ PATH: SHIM_DIR + ':' + process.env.PATH });
function shimRanTheSuite() {
  const log = fs.existsSync(SHIM_LOG) ? fs.readFileSync(SHIM_LOG, 'utf8') : '';
  assert.match(log, /^\d+ --test /m, 'the shim never started node --test, so this arm tested no shim: ' + log.slice(0, 400));
}

/* Behind the shim, the hanging file is still the one stopped and named. QUICK runs beside it and ends normally: if
   the watchdog watched the shim's children instead, it would stop the real node --test (the whole suite), named by
   its last argument, QUICK. */
test('#6668 behind a non-exec node shim, a hanging file is still stopped and named, not the whole suite', () => {
  fs.rmSync(SHIM_LOG, { force: true });
  timesOut(HANG, { also: [QUICK], extra: shimEnv() });
  shimRanTheSuite();
});

test('#6668 CONTROL behind a non-exec node shim: a file under the limit is not stopped and the run is green', () => {
  fs.rmSync(SHIM_LOG, { force: true });
  const r = run(['--only', QUICK], { KOSMOS_TEST_FILE_TIMEOUT_S: QUICK_LIMIT_S, ...shimEnv() });
  assert.equal(r.code, 0, r.out.slice(-1500));
  assert.doesNotMatch(r.out, /TIMED OUT/);
  shimRanTheSuite();
});

test('#6668 CONTROL: a file under the limit is not stopped and the run is green', () => {
  const r = run(['--only', QUICK], { KOSMOS_TEST_FILE_TIMEOUT_S: QUICK_LIMIT_S });
  assert.equal(r.code, 0, r.out.slice(-1500));
  assert.doesNotMatch(r.out, /TIMED OUT/);
  assert.match(r.out, /tests 1\b/);
});

test('#6668 a limit that is not a whole number above 0 (or has a leading 0, or is over a day) is refused before anything runs', () => {
  for (const [k, v] of [['KOSMOS_TEST_FILE_TIMEOUT_MIN', '0'], ['KOSMOS_TEST_FILE_TIMEOUT_MIN', '1.5'], ['KOSMOS_TEST_FILE_TIMEOUT_MIN', '010'],
    ['KOSMOS_TEST_FILE_TIMEOUT_S', 'x'], ['KOSMOS_TEST_FILE_TIMEOUT_S', '0'], ['KOSMOS_TEST_FILE_TIMEOUT_S', '010']]) {
    const r = run(['--only', QUICK], { [k]: v });
    assert.equal(r.code, 2, `${k}=${v}: exit ${r.code}: ${r.out.slice(-600)}`);
    assert.match(r.out, new RegExp(k + ' must be a whole number'));
    assert.doesNotMatch(r.out, /tests 1\b/, `${k}=${v}: a test ran`);
  }
  const r = run(['--only', QUICK], { KOSMOS_TEST_FILE_TIMEOUT_MIN: '1441' });
  assert.equal(r.code, 2, `1441 min: exit ${r.code}: ${r.out.slice(-600)}`);
  assert.match(r.out, /KOSMOS_TEST_FILE_TIMEOUT_MIN must be at most 1440/);
  const r2 = run(['--only', QUICK], { KOSMOS_TEST_FILE_TIMEOUT_S: '86401' });
  assert.equal(r2.code, 2, `86401 s: exit ${r2.code}: ${r2.out.slice(-600)}`);
  assert.match(r2.out, /KOSMOS_TEST_FILE_TIMEOUT_S must be at most 86400/);
});

/* The per-file limit the run used, from the record the runner prints beside a red (and only there: a green run prints
   nothing extra), so this drives a red file. Scaled by the run's KOSMOS_TEST_TIME_SCALE (forced here through
   KOSMOS_FAKE_LOAD, the runner's own knob: a huge load gives the 4x cap, 0 gives 1x), never past 60 min by the
   scaling, and an N set above 60 taken as given. The record is built from the same variable the watchdog reads. */
const RED = path.join(DIR, 'red.test.js');
fs.writeFileSync(RED, `'use strict';\nrequire('node:test')('red on purpose', () => { throw new Error('red on purpose'); });\n`);
/* A red file that ends only once the watchdog has found node --test (its .node marker, beside the run root that is
   this file's TMPDIR, named kt<pid>-file-timeout.*.node), bounded by a scaled 20 s, so the record reports the limit
   and not "not found" however loaded the box is. If the marker never comes it is red anyway and the record says
   "off", which fails the assertion for the right reason. */
const SLOWRED = path.join(DIR, 'slowred.test.js');
fs.writeFileSync(SLOWRED, `'use strict';
const fs = require('node:fs'); const path = require('node:path');
require('node:test')('red once the watchdog has seen node', async () => {
  const root = String(process.env.TMPDIR || '').replace(/\\/$/, '');
  const dir = path.dirname(root); const pre = path.basename(root) + '-file-timeout.';
  const until = Date.now() + ${scaleBudget(20000)};
  const seen = () => { try { return fs.readdirSync(dir).some((f) => f.startsWith(pre) && f.endsWith('.node')); } catch { return false; } };
  while (Date.now() < until && !seen()) await new Promise((r) => setTimeout(r, 50));
  throw new Error('red on purpose');
});
`);
function limitSeen(extra) {
  const r = run(['--only', SLOWRED], { KOSMOS_TEST_FILE_TIMEOUT_S: '', ...extra });
  assert.notEqual(r.code, 0, 'the red fixture did not make the run red: ' + r.out.slice(-800));
  const m = /Limits this run: per-file limit (.+?), per-test limit (\d+) ms \(#6668\)/.exec(r.out);
  const sc = /wall-clock test time-scale ([0-9.]+)x/.exec(r.out);
  assert.ok(m && sc, 'no limit or time-scale in the record beside the red: ' + r.out.slice(-1200));
  return { label: m[1], scale: Number(sc[1]) };
}

test('#6668 a green run prints no limit line (the record is only printed beside a red)', () => {
  const r = run(['--only', QUICK], { KOSMOS_TEST_FILE_TIMEOUT_S: QUICK_LIMIT_S });
  assert.equal(r.code, 0, r.out.slice(-1500));
  assert.doesNotMatch(r.out, /per-file limit/);
});

/* A run red for a reason outside the node part (here the #4273 leak guard: a green file that leaves a new temp family
   in the run root) prints the machine record but no limit line: the limits only explain a node-part red. */
const LEAKY = path.join(DIR, 'leaky.test.js');
fs.writeFileSync(LEAKY, `'use strict';
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
require('node:test')('green, but leaves a temp dir behind', () => { fs.mkdtempSync(path.join(os.tmpdir(), 'leakprobe6668-')); });
`);
test('#6668 a red that is not the node part (a leak-guard red after a green file) prints no limit line', () => {
  const r = run(['--only', LEAKY], { KOSMOS_TEST_FILE_TIMEOUT_S: '' });
  assert.notEqual(r.code, 0, 'the leak guard did not make the run red, so this arm tested nothing: ' + r.out.slice(-800));
  assert.match(r.out, /#4273 LEAK/);
  assert.match(r.out, /=== the machine, when this run started/, 'no machine record, so the absence below proves nothing');
  assert.doesNotMatch(r.out, /Limits this run/);
});

/* A watchdog that could not start (its flag file could not be made: a TMPDIR that refuses writes) enforced nothing,
   and the record beside the red says so instead of claiming a limit. */
test('#6668 a run whose watchdog could not start says the per-file limit was off', (t) => {
  const ro = fs.mkdtempSync(path.join(DIR, 'ro-'));
  fs.chmodSync(ro, 0o555);
  try {
    // A user the mode does not bind (uid 0, or a filesystem that ignores it) can still write here: then nothing
    // would refuse the flag file, so the arm is skipped rather than passed for the wrong reason.
    let writable = true;
    try { fs.writeFileSync(path.join(ro, 'probe'), ''); fs.rmSync(path.join(ro, 'probe')); } catch { writable = false; }
    if (writable) { t.skip('the 0555 directory is still writable for this user, so the flag file cannot be refused here'); return; }
    const r = run(['--only', RED], { TMPDIR: ro, KOSMOS_TEST_FILE_TIMEOUT_S: '' });
    assert.notEqual(r.code, 0, r.out.slice(-800));
    assert.match(r.out, /could not make the file watchdog's flag file/, 'the watchdog started anyway, so this arm tested nothing: ' + r.out.slice(-800));
    assert.match(r.out, /Limits this run: per-file limit: off \(the watchdog could not start\), per-test limit \d+ ms/);
    assert.doesNotMatch(r.out, /Limits this run: per-file limit \d/);
  } finally {
    fs.chmodSync(ro, 0o755);
  }
});

test('#6668 the per-file limit scales with the load, is capped at 60 min by the scaling, and takes a larger N as set', () => {
  assert.deepEqual(limitSeen({ KOSMOS_FAKE_LOAD: '0', KOSMOS_TEST_FILE_TIMEOUT_MIN: '10' }), { label: '10 min', scale: 1 });
  assert.deepEqual(limitSeen({ KOSMOS_FAKE_LOAD: '100000', KOSMOS_TEST_FILE_TIMEOUT_MIN: '10' }), { label: '40 min', scale: 4 });
  assert.deepEqual(limitSeen({ KOSMOS_FAKE_LOAD: '100000' }), { label: '60 min', scale: 4 }, 'the default 30 min at 4x must stop at the 60 min cap');
  assert.deepEqual(limitSeen({ KOSMOS_FAKE_LOAD: '100000', KOSMOS_TEST_FILE_TIMEOUT_MIN: '90' }), { label: '90 min', scale: 4 });
});

/* A file that waits 30 s on a timer, so node answers a Ctrl-C while the runner is stopped under it. */
const SLOW = path.join(DIR, 'slow.test.js');
fs.writeFileSync(SLOW, `'use strict';
require('node:test')('waits thirty seconds', () => new Promise((r) => setTimeout(r, 30000)));
`);
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
function childrenOf(pid) {
  const r = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' });
  return (r.stdout || '').split('\n').filter(Boolean).map(Number);
}
function commandOf(pid) {
  return (spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).stdout || '').trim();
}
/* node --test by the runner's own rule (its watchdog's case: "node --test "* or *"/node --test "*): by name, or by full
   path. Under `yarn test` (how Mortals runs the suite), yarn puts a `node` first on PATH that execs node by its full
   path, so the runner's node --test reads /opt/homebrew/Cellar/node/<v>/bin/node --test ... and a bare-name match
   never finds it. */
const isNodeTest = (cmd) => cmd.startsWith('node --test ') || cmd.includes('/node --test ');
/* For a red only: the runner and every process under it, with its state and command line. */
function treeOf(root) {
  const rows = (spawnSync('ps', ['-A', '-ww', '-o', 'pid=,ppid=,stat=,command='], { encoding: 'utf8' }).stdout || '').split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(l)).filter(Boolean).map((m) => ({ pid: +m[1], ppid: +m[2], line: m[0].trim() }));
  const keep = new Set([root]);
  for (let grew = true; grew;) { grew = false; for (const r of rows) if (keep.has(r.ppid) && !keep.has(r.pid)) { keep.add(r.pid); grew = true; } }
  return rows.filter((r) => keep.has(r.pid)).map((r) => '  ' + r.line).join('\n') || '  (none: the runner is gone)';
}

/* The runner is stopped the way a queue timeout (TERM to the runner) or a person (Ctrl-C: INT to the whole
   foreground group) stops it, at a 60 s limit, so the loop's tick is 5 s. Then the watchdog must be gone within
   WINDOW ms of the runner's exit. label: names this arm's output file. extra: more env for the runner. Returns how
   long it took and node --test's command line as the runner's child. */
async function stoppedRunnerLeavesNoWatchdog(label, how, windowMs, extra = {}) {
  assert.ok(KNOWS_ONLY, 'tools/run-tests.sh has no --only: not running it, since it would run the whole suite');
  /* The runner's output goes to a file, read into any red below: a runner that refused or failed before node is
     then named by its own words, never only by "no watchdog". */
  const log = path.join(DIR, `stopped-${label}.log`);
  const fd = fs.openSync(log, 'w');
  let child;
  try { child = spawn('bash', [RUNNER, '--only', SLOW], { env: env({ KOSMOS_TEST_FILE_TIMEOUT_S: '60', ...extra }), detached: true, stdio: ['ignore', fd, fd] }); } finally { fs.closeSync(fd); }
  const exited = new Promise((r) => child.on('exit', r));
  const said = () => { try { return fs.readFileSync(log, 'utf8').slice(-1500); } catch { return '(no output file)'; } };
  try {
    /* The watchdog is the runner's child (by parent pid) that is not node --test and that persists: a $(...) the
       runner forks is gone within milliseconds, so a pid present in three snapshots a scaled 300 ms apart, with the
       runner's own command line (a subshell copies it), is the loop. Retried until one candidate remains. */
    let watchdog = null;
    let last = [];
    let nodeCmd = '';
    const runnerCmd = () => commandOf(child.pid);
    const candidates = () => {
      const kids = childrenOf(child.pid);
      const node = kids.map(commandOf).find(isNodeTest);
      if (!node) return null;
      nodeCmd = node;
      const own = runnerCmd();
      return kids.filter((k) => commandOf(k) === own);
    };
    const appear = Date.now() + scaleBudget(30000);   // for node --test to start and the watchdog to settle
    while (Date.now() < appear && watchdog === null) {
      let seen = candidates();
      for (let i = 0; seen && i < 2; i++) {
        await nap(scaleBudget(300));
        const next = candidates();
        seen = next && seen.filter((k) => next.includes(k));
      }
      last = seen || [];
      if (seen && seen.length === 1) watchdog = seen[0];
      else await nap(100);
    }
    assert.ok(watchdog, 'no single persistent watchdog under the runner (node --test not started, or candidates: ' + last.join(' ') +
      ')\nthe runner\'s processes:\n' + treeOf(child.pid) + '\nthe runner said:\n' + said());
    if (how === 'TERM') process.kill(child.pid, 'SIGTERM');
    else process.kill(-child.pid, 'SIGINT');
    await Promise.race([exited, nap(scaleBudget(10000))]);
    const from = Date.now();
    while (alive(watchdog) && Date.now() - from < windowMs) await nap(20);
    const took = Date.now() - from;
    assert.equal(alive(watchdog), false, `${how}: the watchdog (pid ${watchdog}) was still running ${windowMs} ms after the runner stopped` +
      '\nthe runner\'s processes:\n' + treeOf(child.pid) + '\nthe runner said:\n' + said());
    return { took, nodeCmd };
  } finally {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* the group is gone */ }
  }
}

/* A stop honoured mid-loop: two files that ignore TERM pass the limit on the same look; the runner is TERMed as soon
   as the first is named. The watchdog must stop at its next check and never reach the second, so exactly one TIMED
   OUT line is printed. (Without the checks it would KILL the first after its grace and go on to the second.) */
const STUB2 = hangFixture('stubborn2.test.js', true);
test('#6668 a watchdog stopped while it is stopping one file does not go on to the next', async () => {
  assert.ok(KNOWS_ONLY, 'tools/run-tests.sh has no --only: not running it, since it would run the whole suite');
  fs.rmSync(PIDS, { force: true });
  const child = spawn('bash', [RUNNER, '--only', STUBBORN, STUB2], { env: env({ KOSMOS_TEST_FILE_TIMEOUT_S: '3' }),
    detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  try {
    const named = Date.now() + scaleBudget(60000);
    while (!/TIMED OUT after/.test(out) && Date.now() < named) await nap(50);
    assert.match(out, /TIMED OUT after/, 'no file was ever stopped, so this arm tested nothing: ' + out.slice(-800));
    process.kill(child.pid, 'SIGTERM');
    await nap(scaleBudget(8000));   // the unchecked loop would print the second line within its 5 s grace plus a look
    assert.equal((out.match(/TIMED OUT after/g) || []).length, 1, 'the watchdog went on after its stop: ' + out.slice(-1200));
  } finally {
    // The runner's own process group holds both fixtures (they ignored the TERM and their KILL was skipped).
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* the group is gone */ }
  }
});

/* Liveness at any scale: the watchdog is gone after a TERM (the exit trap or the loop's own next look at its parent,
   as a pair; the exit trap alone is not proven by a test). */
test('#6668 a runner sent TERM leaves no watchdog', async () => { await stoppedRunnerLeavesNoWatchdog('term', 'TERM', scaleBudget(7000)); });
/* This arm guards the PAIR (the exit trap or the normal stop after node): on a Ctrl-C bash outlives node and stops
   the watchdog normally, so it stays green with the trap's stop removed. */
test('#6668 a runner stopped by Ctrl-C (INT to its group) leaves no watchdog', async () => { await stoppedRunnerLeavesNoWatchdog('int', 'INT', scaleBudget(1000)); });
/* The same, with yarn's own `node` first on PATH (an exec of node by its full path, as `yarn test` puts there), so
   node --test reads by its full path. The arm proves the wrapper was in the path: the runner's child is node by the
   full path this test's node runs from. */
const EXEC_DIR = fs.mkdtempSync(path.join(DIR, 'execnode-'));
/* The path in single quotes, each ' in it written as '\\'' (sh expands nothing inside single quotes). */
const shQuote = (v) => "'" + String(v).replace(/'/g, "'\\''") + "'";
fs.writeFileSync(path.join(EXEC_DIR, 'node'), `#!/bin/sh\n\nexec ${shQuote(process.execPath)} "$@"\n`, { mode: 0o755 });
test('#6668 behind yarn\'s node (an exec by full path), a runner sent TERM still leaves no watchdog', async () => {
  const { nodeCmd } = await stoppedRunnerLeavesNoWatchdog('term-execnode', 'TERM', scaleBudget(7000), { PATH: EXEC_DIR + ':' + process.env.PATH });
  assert.ok(nodeCmd.startsWith(process.execPath + ' --test '), 'node --test did not run by its full path, so this arm tested no wrapper: ' + nodeCmd);
});

test('#6668 the node --test line carries --test-timeout for async hangs, before the files where node applies it', () => {
  const line = RUNNER_SRC.split('\n').find((l) => /^node --test /.test(l));
  assert.ok(line, 'run-tests.sh has no `node --test` line');
  assert.match(line, / --test-timeout="\$RT_TEST_TIMEOUT_MS" "\$\{KOSMOS_TEST_FILES\[@\]\}"/);
});

/* What node's children actually get: each test file's process carries --test-timeout in its execArgv. */
const ARGV = path.join(DIR, 'argv.test.js');
fs.writeFileSync(ARGV, `'use strict';
require('node:test')('argv', () => {
  console.log('TIMEOUT ' + JSON.stringify({ argv: process.execArgv.join(' '), scale: process.env.KOSMOS_TEST_TIME_SCALE || null }));
});
`);
function seenTimeout(extra) {
  const r = run(['--only', ARGV], extra);
  assert.equal(r.code, 0, r.out.slice(-1500));
  const j = JSON.parse((r.out.match(/TIMEOUT (\{.*\})/) || [])[1] || 'null');
  assert.ok(j, 'the probe printed nothing: ' + r.out.slice(-800));
  const m = /--test-timeout=(\d+)/.exec(j.argv);
  assert.ok(m, 'the file\'s process has no --test-timeout: ' + j.argv);
  return { ms: Number(m[1]), scale: Number(j.scale) };
}

test('#6668 the per-test timeout is 600000 scaled by the run\'s KOSMOS_TEST_TIME_SCALE', () => {
  const { ms, scale } = seenTimeout({});
  assert.ok(scale >= 1 && scale <= 4, 'the run exported no scale in [1, 4]: ' + scale);
  assert.equal(ms, Math.round(600000 * scale));
});

test('#6668 KOSMOS_TEST_TIMEOUT_MS overrides it, and a bad value is refused before anything runs', () => {
  assert.equal(seenTimeout({ KOSMOS_TEST_TIMEOUT_MS: '1234567' }).ms, 1234567);
  for (const v of ['0', '012', 'x', '1234567890']) {
    const r = run(['--only', ARGV], { KOSMOS_TEST_TIMEOUT_MS: v });
    assert.equal(r.code, 2, `KOSMOS_TEST_TIMEOUT_MS=${v}: exit ${r.code}: ${r.out.slice(-600)}`);
    assert.match(r.out, /KOSMOS_TEST_TIMEOUT_MS must be/);
    assert.doesNotMatch(r.out, /TIMEOUT \{/, `KOSMOS_TEST_TIMEOUT_MS=${v}: a test ran`);
  }
});

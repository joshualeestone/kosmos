'use strict';

/**
 * kosmos#9159: a TERM to tools/run-tests.sh ends bash, and its foreground `node --test` (same process group, but not
 * the target of a TERM sent to bash's pid) used to run on, reparented to 1 and still starting test files: a stopped
 * suite kept loading a shared Mac, unclaimed. The runner's EXIT trap now stops its own node --test and that runner's
 * children. This file TERMs the real runner's bash pid, ALONE, while --only runs a fixture that sleeps, and asserts the
 * fixture and its node --test are gone within a grace.
 *
 *   node --test tools.run-tests-term-9159.test.js
 */
require('./test-support/tmpscope');
const SKIP_POSIX_SIGNALS = require('./test-support/skip-on-win32').skipOnWin32('it sends SIGTERM to tools/run-tests.sh and its process group and checks what is left running, which needs POSIX signals and process groups; whether that works on Windows is owed on kosmos#9278');   // kosmos#8378
const test = require('node:test');
/* A run this file starts must never start this file again (the same stand-down as tools.run-tests-file-timeout-6668). */
if (process.env.KOSMOS_TERM_9159_INNER === '1') {
  test('stands down inside its own inner run', { skip: 'started by tools.run-tests-term-9159.test.js itself' }, () => {});
  return;
}
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { scaleBudget } = require('./test-support/eventually');

const RUNNER = path.join(__dirname, 'tools', 'run-tests.sh');
const RUNNER_SRC = fs.readFileSync(RUNNER, 'utf8');
/* Read, never run, to see whether this runner knows --only: running one that does not starts the whole suite. */
const KNOWS_ONLY = /\[ "\$\{1:-\}" = --only \]/.test(RUNNER_SRC);
const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'term-9159-')));
test.after(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ } });
/* What run-tests.sh exports, or what a queue turn or node --test hands down: none of it may reach the inner run. */
const RUNNER_SET = ['AGENT_WORKFORCE_CREATED_URL', 'AGENT_WORKFORCE_FEEDBACK_URL', 'AGENT_WORKFORCE_COMMUNITY_URL',
  'KOSMOS_CATALOGUE_BASE', 'AGENT_WORKFORCE_GH_BIN', 'AGENT_WORKFORCE_VERCEL_BIN', 'KOSMOS_NO_LEGACY_MIGRATION',
  'KOSMOS_TEST_PART', 'KOSMOS_TEST_PART_LOCAL', 'KOSMOS_SHELL_SHARD', 'KOSMOS_SHELL_PLATFORM', 'KOSMOS_MACHINE_CLAIM_COOKIE',
  'KOSMOS_LIGHT_SIDE_COOKIE', 'NODE_TEST_CONTEXT', 'KOSMOS_TEST_FILE_TIMEOUT_MIN', 'KOSMOS_TEST_FILE_TIMEOUT_S',
  'KOSMOS_TEST_TIMEOUT_MS', 'KOSMOS_RT_STOP_OWN_NODE', 'TMUX', 'TMUX_PANE'];   // the seam too (review 5)
const PLAIN_TMP = fs.mkdtempSync(path.join(DIR, 'tmp-'));
const SANDBOX_HOME = fs.mkdtempSync(path.join(DIR, 'home-'));
function env() {
  const e = { ...process.env };
  for (const k of RUNNER_SET) delete e[k];
  return Object.assign(e, { TMPDIR: PLAIN_TMP, HOME: SANDBOX_HOME, KOSMOS_TERM_9159_INNER: '1',
    KOSMOS_IGNORE_MACHINE_CLAIM: '1', KOSMOS_TESTS_IGNORE_HARNESS: '1' });
}
/* The runner starts in its own process group under a small perl parent; the test's own cleanup TERMs and KILLs that
   whole group, so a failing arm never leaves the fixture running. */
const GROUP = 'setpgrp(0, 0); my $pid = fork; die "fork: $!" unless defined $pid; if (!$pid) { exec @ARGV or exit 127 } ' +
  'waitpid($pid, 0); exit(($? & 127) ? 128 + ($? & 127) : $? >> 8)';

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function ppidOf(pid) {
  const r = spawnSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' });
  const n = parseInt((r.stdout || '').trim(), 10);
  return Number.isFinite(n) ? n : 0;
}
function childrenOf(pid) {
  const r = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' });
  return (r.stdout || '').split('\n').map((l) => l.trim().split(/\s+/).map(Number))
    .filter(([p, pp]) => pp === pid && Number.isFinite(p)).map(([p]) => p);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(200); }
  return fn();
}

const PIDS = path.join(DIR, 'fixture.pids');
const KIDS = path.join(DIR, 'fixture-child.pids');
const FIXTURE = path.join(DIR, 'sleeps-9159.test.js');
/* The file starts a child of its own (as a stub server or a browser would) and records both pids. */
fs.writeFileSync(FIXTURE, `'use strict';
const fs = require('node:fs');
const kid = require('node:child_process').spawn('perl', ['-e', 'sleep 120'], { stdio: 'ignore' });
fs.appendFileSync(${JSON.stringify(KIDS)}, kid.pid + '\\n');
fs.appendFileSync(${JSON.stringify(PIDS)}, process.pid + '\\n');
require('node:test')('sleeps two minutes', () => new Promise((r) => setTimeout(r, 120000)));
`);
const firstPid = (f) => { const t = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : ''; return t ? parseInt(t.split('\n')[0], 10) : 0; };

test('#9159: a TERM to run-tests.sh ALONE stops its node --test, the file it was running, and the file\'s own child', { skip: SKIP_POSIX_SIGNALS }, async () => {
  assert.ok(KNOWS_ONLY, 'tools/run-tests.sh has no --only: not running it, since it would run the whole suite');
  const perl = spawn('perl', ['-e', GROUP, 'bash', RUNNER, '--only', FIXTURE], { env: env(), stdio: 'ignore' });
  try {
    const filePid = await until(() => firstPid(PIDS), scaleBudget(60000));
    const kidPid = firstPid(KIDS);
    assert.ok(filePid > 0, 'the fixture never started (no pid written)');
    const bashPid = childrenOf(perl.pid)[0];
    assert.ok(bashPid > 0, 'run-tests.sh was not found under its perl parent');
    const nodePid = ppidOf(filePid);
    // CONTROL: the fixture really is under this runner through its node --test (a node shim, as Volta's, adds one
    // level: review 1), so a pass cannot come from stopping something else.
    const up = ppidOf(nodePid);
    assert.ok(up === bashPid || ppidOf(up) === bashPid, `the fixture's node --test (${nodePid}) is not under run-tests.sh (${bashPid})`);
    assert.ok(kidPid > 0 && alive(kidPid), 'the fixture\'s own child did not start');
    process.kill(bashPid, 'SIGTERM');   // the runner's pid ALONE, as a person or a wrapper sends it
    const gone = await until(() => !alive(filePid) && !alive(nodePid) && !alive(kidPid), scaleBudget(20000));
    assert.ok(gone, `after a TERM to run-tests.sh (${bashPid}), its node --test (${nodePid}: ${alive(nodePid) ? 'alive' : 'gone'}), ` +
      `the file (${filePid}: ${alive(filePid) ? 'alive' : 'gone'}) and the file's own child (${kidPid}: ${alive(kidPid) ? 'alive' : 'gone'}) were not all stopped`);
  } finally {
    { const k = firstPid(KIDS); if (k) { try { process.kill(k, 'SIGKILL'); } catch { /* gone */ } } }   // by pid as well as by group
    try { process.kill(-perl.pid, 'SIGTERM'); } catch { /* gone */ }
    await sleep(500);
    try { process.kill(-perl.pid, 'SIGKILL'); } catch { /* gone */ }
  }
});

/* Review 3: the KILL after the grace, and its "command line unchanged" check (ps output read twice, compared). A file
   that IGNORES TERM must still be gone; a check that never compared equal would skip every KILL and leave it. */
const PIDS2 = path.join(DIR, 'stubborn.pids');
const FIXTURE2 = path.join(DIR, 'stubborn-9159.test.js');
fs.writeFileSync(FIXTURE2, `'use strict';
process.on('SIGTERM', () => {});
require('node:fs').appendFileSync(${JSON.stringify(PIDS2)}, process.pid + '\\n');
require('node:test')('ignores TERM and sleeps', () => new Promise((r) => setTimeout(r, 120000)));
`);
test('#9159: a test file that ignores TERM is KILLed after the grace, and the stop names it', { skip: SKIP_POSIX_SIGNALS }, async () => {
  assert.ok(KNOWS_ONLY, 'tools/run-tests.sh has no --only: not running it, since it would run the whole suite');
  let err = '';
  const perl = spawn('perl', ['-e', GROUP, 'bash', RUNNER, '--only', FIXTURE2], { env: env(), stdio: ['ignore', 'ignore', 'pipe'] });
  perl.stderr.on('data', (d) => { err += d; });
  try {
    const filePid = await until(() => firstPid(PIDS2), scaleBudget(60000));
    assert.ok(filePid > 0, 'the stubborn fixture never started (no pid written)');
    const bashPid = childrenOf(perl.pid)[0];
    assert.ok(bashPid > 0, 'run-tests.sh was not found under its perl parent');
    process.kill(bashPid, 'SIGTERM');
    const gone = await until(() => !alive(filePid), scaleBudget(30000));
    assert.ok(gone, `a file that ignores TERM (${filePid}) was still alive after the grace: its KILL was skipped`);
    await until(() => /stopped process \d+ this run was still running/.test(err), scaleBudget(5000));
    assert.match(err, new RegExp(`stopped process ${filePid} this run was still running`), 'the stop did not name the file it stopped: ' + err.slice(-600));
  } finally {
    try { process.kill(-perl.pid, 'SIGKILL'); } catch { /* gone */ }
  }
});

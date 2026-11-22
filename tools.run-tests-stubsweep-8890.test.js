'use strict';
/* kosmos#8890: a run of tools/run-tests.sh that is stopped part way stops the processes its tests left running inside
   its own run root (kt<pid>), such as a test's stub server, which otherwise outlive the folder re-parented to init and
   hold their ports. CONTROLS: a process under ANOTHER run's root survives, and so does one under a root whose name only
   begins with this run's (kt<pid>9), since a match by prefix would take it, and so does a process that names THIS run's
   root but is someone else's (alive parent outside the run: an operator's tail -f, another agent's ls; review 1).
   Only the TERM arm proves #8890: on a Ctrl-C bash outlives node and the end-of-run leak guard (#4273) ends the stub. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { scaleBudget } = require('./test-support/eventually');

const RUNNER = path.join(__dirname, 'tools', 'run-tests.sh');
const RUNNER_SRC = fs.readFileSync(RUNNER, 'utf8');
const KNOWS_ONLY = /\[ "\$\{1:-\}" = --only \]/.test(RUNNER_SRC);
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stubsweep-8890-'));
test.after(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

/* What run-tests.sh exports, or a queue turn or node --test hands down: none of it may reach the inner run (as in
   tools.run-tests-file-timeout-6668.test.js). */
const RUNNER_SET = ['AGENT_WORKFORCE_CREATED_URL', 'AGENT_WORKFORCE_FEEDBACK_URL', 'AGENT_WORKFORCE_COMMUNITY_URL',
  'KOSMOS_CATALOGUE_BASE', 'AGENT_WORKFORCE_GH_BIN', 'AGENT_WORKFORCE_VERCEL_BIN', 'KOSMOS_NO_LEGACY_MIGRATION',
  'KOSMOS_TEST_PART', 'KOSMOS_TEST_PART_LOCAL', 'KOSMOS_SHELL_SHARD', 'KOSMOS_SHELL_PLATFORM', 'KOSMOS_MACHINE_CLAIM_COOKIE',
  'KOSMOS_LIGHT_SIDE_COOKIE', 'NODE_TEST_CONTEXT', 'KOSMOS_TEST_FILE_TIMEOUT_MIN', 'KOSMOS_TEST_FILE_TIMEOUT_S',
  'KOSMOS_TEST_TIMEOUT_MS', 'TMUX', 'TMUX_PANE'];
const PLAIN_TMP = fs.mkdtempSync(path.join(DIR, 'tmp-'));
const SANDBOX_HOME = fs.mkdtempSync(path.join(DIR, 'home-'));
function env() {
  const e = { ...process.env };
  for (const k of RUNNER_SET) delete e[k];
  return { ...e, TMPDIR: PLAIN_TMP, HOME: SANDBOX_HOME, KOSMOS_IGNORE_MACHINE_CLAIM: '1', KOSMOS_TESTS_IGNORE_HARNESS: '1' };
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
const STUB_SRC = "setInterval(() => {}, 1000);\n";

/* A stub server's shape: a script written INSIDE the run's TMPDIR (the run root), started detached in its own session,
   so it is in no group the runner stops and its parent's death re-parents it to init. It writes its pid for the arm. */
const PIDS = path.join(DIR, 'stub.pid');
const FIXTURE = path.join(DIR, 'leaves-a-stub.test.js');
fs.writeFileSync(FIXTURE, `'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
require('node:test')('starts a stub server and waits', () => {
  const script = path.join(os.tmpdir(), 'kosmos-stub-8890.js');
  fs.writeFileSync(script, ${JSON.stringify(STUB_SRC)});
  const c = spawn(process.execPath, [script], { detached: true, stdio: 'ignore' });
  c.unref();
  fs.writeFileSync(${JSON.stringify(PIDS)}, c.pid + '\\n');
  return new Promise((r) => setTimeout(r, 120000));
});
`);

/* A control: the same stub, under a root this run does not own. */
function control(rootName) {
  const dir = path.join(PLAIN_TMP, rootName);
  fs.mkdirSync(dir, { recursive: true });
  const script = path.join(dir, 'kosmos-stub-control.js');
  fs.writeFileSync(script, STUB_SRC);
  const c = spawn(process.execPath, [script], { detached: true, stdio: 'ignore' });
  c.unref();
  return c.pid;
}

/* `said`: the line that must name the stub. On a TERM to the group bash exits through its EXIT trap at once, so the
   new stop (#8890) is what ends the stub. On a Ctrl-C bash outlives node and finishes the run, so the end-of-run leak
   guard (leak_process_check, #4273) usually ends it first, naming it as a leak; that arm guards the pair. */
async function stoppedRunLeavesNoStub(signal, said0) {
  assert.ok(KNOWS_ONLY, 'tools/run-tests.sh has no --only: not running it, since it would run the whole suite');
  fs.rmSync(PIDS, { force: true });
  const log = path.join(DIR, `run-${signal}.log`);
  const fd = fs.openSync(log, 'w');
  let child;
  try { child = spawn('bash', [RUNNER, '--only', FIXTURE], { env: env(), detached: true, stdio: ['ignore', fd, fd] }); } finally { fs.closeSync(fd); }
  const exited = new Promise((r) => child.on('exit', r));
  const said = () => { try { return fs.readFileSync(log, 'utf8').slice(-1500); } catch { return '(no output file)'; } };
  const controls = [];
  let stub = 0;
  try {
    const appear = Date.now() + scaleBudget(60000);
    while (!stub && Date.now() < appear) {
      try { stub = Number(fs.readFileSync(PIDS, 'utf8').trim()) || 0; } catch { /* not yet */ }
      if (!stub) await nap(100);
    }
    assert.ok(stub && alive(stub), 'the fixture never started its stub, so this arm tested nothing\nthe runner said:\n' + said());
    /* The run's own root is kt<runner pid>; the controls sit under kt<runner pid>9 and an unrelated kt root. */
    controls.push(control('kt' + child.pid + '9'), control('kt999999999'));
    /* Review 1: alive, not orphaned, not the runner's, and its command line names this run's own root. */
    const observer = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', path.join(PLAIN_TMP, 'kt' + child.pid, 'observed.log')], { stdio: 'ignore' });
    controls.push(observer.pid);
    assert.ok(controls.every(alive), 'a control stub did not start');
    /* Stopped as a queue timeout or a person stops it: the whole foreground group (node --test with it). */
    process.kill(-child.pid, signal);
    const code = await Promise.race([exited, nap(scaleBudget(90000)).then(() => 'still running')]);   // the leak guard's sweep is slow under load
    assert.notEqual(code, 'still running', 'the runner did not exit after ' + signal + '\nthe runner said:\n' + said());
    const from = Date.now();
    while (alive(stub) && Date.now() - from < scaleBudget(5000)) await nap(50);
    assert.equal(alive(stub), false, `${signal}: the stub (pid ${stub}) the stopped run left is still running\nthe runner said:\n` + said());
    const whole = fs.readFileSync(log, 'utf8');   // the whole log: the leak guard's own lines can follow this one
    assert.match(whole, said0(stub), 'the runner did not say what it stopped\n' + said());
    assert.deepEqual(controls.filter((p) => !alive(p)), [], 'CONTROL: a process under another run\'s root, or someone else\'s naming this root, was stopped too (order: kt<pid>9, other root, observer): ' + controls.join(' '));
  } finally {
    for (const p of [stub, ...controls]) if (p && alive(p)) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } }
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* the group is gone */ }
  }
}

test('#8890 a run stopped by TERM to its group stops the stub its test left in its root, and no other', async () => {
  await stoppedRunLeavesNoStub('SIGTERM', (pid) => new RegExp('stopped process ' + pid + ' this run left running'));
});
test('#8890 a run stopped by Ctrl-C (INT to its group) still ends the stub its test left in its root, and no other (the pair)', async () => {
  await stoppedRunLeavesNoStub('SIGINT', (pid) => new RegExp('stopped process ' + pid + ' this run left running|^\\s*process ' + pid + ': ', 'm'));
});

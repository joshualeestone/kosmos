'use strict';
/* kosmos#8890: a run of tools/run-tests.sh that is stopped part way stops the processes its tests left running inside
   its own run root (kt<pid>), such as a test's stub server, which otherwise outlive the folder re-parented to init and
   hold their ports. In the two run arms, the CONTROLS (stubs under kt<pid>9 and another root, and an observer naming
   THIS run's root) all have a live parent outside the run, so the ownership rule is what protects them there; the
   matcher's exactness (kt<pid>9) is proven by the direct arm at the end, with real orphans (review 4).
   Only the TERM arm proves #8890 end to end: on a Ctrl-C bash outlives node and the end-of-run leak guard (#4273)
   ends the stub, so that arm guards the older path, not this card's. */
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

/* A killed child of this test stays a zombie until node reaps it, which it cannot while a spawnSync blocks; kill(pid, 0)
   still answers for a zombie, so a zombie counts as gone (ps state Z). */
const alive = (pid) => {
  try { process.kill(pid, 0); } catch (e) { if (e.code !== 'EPERM') return false; }
  const st = (require('node:child_process').spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout || '').trim();
  return st !== '' && !st.startsWith('Z');
};
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
    /* #9115: on a Ctrl-C bash outlives node and finishes the run (the leak guard's sweep), which is slow on the CI Mac:
       passing CI runs took this arm 37 s, 49 s, 54 s and 89.8 s against a 90 s bound, and one went 0.6 s over (here it
       takes about 6 s). The bound is for a runner that never exits, so it has room: 240 s, scaled. */
    const code = await Promise.race([exited, nap(scaleBudget(240000)).then(() => 'still running')]);
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
test('#8890 guard on #4273: a run stopped by Ctrl-C (INT to its group) still ends the stub, by either path, and no other', async () => {
  await stoppedRunLeavesNoStub('SIGINT', (pid) => new RegExp('stopped process ' + pid + ' this run left running|^\\s*process ' + pid + ': ', 'm'));
});

/* Review 2: leak_process_stop_root itself, so each rule is proven on a process that only that rule decides. A bash
   script loads the lib and is "this run" ($$): a DESCENDANT of it (alive parent: the script) and a real ORPHAN (its
   launcher exited) under the root are stopped; ORPHANS under kt<n>9 (prefix) and another root survive (only the
   matcher decides those, since the ownership rule lets orphans through); an OBSERVER that names the root, owned by this
   test (alive, outside the script), survives (only the ownership rule decides that). */
const LIB = path.join(__dirname, 'tools', 'lib', 'test-leak-guard.sh');
const UNIT = path.join(DIR, 'unit-8890.sh');
fs.writeFileSync(UNIT, `#!/bin/bash
. "$1"
ROOT="$2"; OTHER="$3"; OUT="$4"
# exec: each pid is the node itself, not a bash subshell (whose command line, the script's, names the root too).
stub() { exec "$NODE_BIN" -e 'setInterval(() => {}, 1000)' "$1" </dev/null >/dev/null 2>&1; }   # no inherited pipe: a surviving control must not hold this script's output open
stub "$ROOT/desc.js" & desc=$!; echo $desc > "$OUT.desc"
# Review 3: one that ignores TERM, so the KILL path runs.
( exec "$NODE_BIN" -e 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)' "$ROOT/stubborn.js" </dev/null >/dev/null 2>&1 & echo $! > "$OUT.stubborn" )
( stub "$ROOT/orphan.js" & echo $! > "$OUT.orphan" )
( stub "\${ROOT}9/prefix.js" & echo $! > "$OUT.prefix" )
( stub "$OTHER/other.js" & echo $! > "$OUT.other" )
sleep 0.5
echo "desc=$desc orphan=$(cat "$OUT.orphan") prefix=$(cat "$OUT.prefix") other=$(cat "$OUT.other") stubborn=$(cat "$OUT.stubborn")" > "$OUT"
leak_process_stop_root "$ROOT"
wait "$desc" 2>/dev/null
exit 0
`);
test('#8890 the function stops a descendant and an orphan under the root, and no orphan under a lookalike or other root, nor someone else\'s process naming it', () => {
  const root = path.join(PLAIN_TMP, 'kt' + (4000000 + Math.floor(Math.random() * 100000)));
  const other = path.join(PLAIN_TMP, 'kt-other-unit');
  fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(root + '9', { recursive: true }); fs.mkdirSync(other, { recursive: true });
  const out = path.join(DIR, 'unit.out');
  const observer = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', path.join(root, 'observed.log')], { stdio: 'ignore' });
  const pids = {};
  try {
    const r = require('node:child_process').spawnSync('bash', [UNIT, LIB, root, other, out], { encoding: 'utf8', timeout: scaleBudget(30000), env: { ...process.env, NODE_BIN: process.execPath } });
    assert.ok(!(r.error && r.error.code === 'ETIMEDOUT'), 'the script did not finish: ' + (r.stdout || '') + (r.stderr || ''));
    for (const kv of fs.readFileSync(out, 'utf8').trim().split(' ')) { const [k, v] = kv.split('='); pids[k] = Number(v); }
    assert.ok(pids.desc && pids.orphan && pids.prefix && pids.other && pids.stubborn, 'the script did not start its five stubs: ' + JSON.stringify(pids) + ' ' + r.stderr);
    const said = (r.stdout || '') + (r.stderr || '');
    const deadline = Date.now() + scaleBudget(5000);
    while ((alive(pids.desc) || alive(pids.orphan) || alive(pids.stubborn)) && Date.now() < deadline) require('node:child_process').spawnSync('sleep', ['0.1']);
    assert.equal(alive(pids.desc), false, 'a DESCENDANT under the root was not stopped (the descendant walk): ' + said);
    assert.equal(alive(pids.orphan), false, 'an ORPHAN under the root was not stopped: ' + said);
    assert.equal(alive(pids.prefix), true, 'CONTROL: an orphan under kt<n>9 was stopped (a match by prefix): ' + said);
    assert.equal(alive(pids.other), true, 'CONTROL: an orphan under another root was stopped: ' + said);
    assert.equal(alive(observer.pid), true, 'CONTROL: someone else\'s live process naming the root was stopped (the ownership rule): ' + said);
    assert.match(said, new RegExp('stopped process ' + pids.desc + ' '));
    assert.match(said, new RegExp('stopped process ' + pids.orphan + ' '));
    assert.equal(alive(pids.stubborn), false, 'a process that ignores TERM under the root was not KILLed: ' + said);
    assert.match(said, new RegExp('KILLed process ' + pids.stubborn + ', which outlived its TERM'), 'the KILL was not said: ' + said);
  } finally {
    /* Review 3: from each stub's own pid file, so a script that died before writing the summary leaves nothing. */
    for (const k of ['desc', 'orphan', 'prefix', 'other', 'stubborn']) {
      if (!pids[k]) { try { pids[k] = Number(fs.readFileSync(out + '.' + k, 'utf8').trim()) || 0; } catch { /* not written */ } }
    }
    for (const pid of [pids.desc, pids.orphan, pids.prefix, pids.other, pids.stubborn, observer.pid]) if (pid && alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  }
});

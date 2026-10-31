'use strict';
/* kosmos#7619: tools/prove-it-fails.sh, killed mid-run, restores the tree. On 10-30 the tmux server died and sent a
   hangup to every run in every pane; a mutation run that dies holding its break leaves it for the next commit. The tool
   runs here in a throwaway git repo of its own (a copy of the script, a file to break and a slow test), and is sent
   the signal while its test is still running. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'tools', 'prove-it-fails.sh');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// How long a killed process may take to go before it counts as left running. A full suite at load 12 to 24 took about
// 11 s here (PigeonPete, 10-30), past the old 10 s; so 60 s. Every process the tool should kill is made to outlive
// this on its own (a 180 s test hold, a 300 s sleep), so one that was NOT killed is still alive when the wait ends
// and the arm goes red: the margin never lets a missed kill pass.
const DIE_WAIT_MS = 60000;
// How long the tool may take to END after the signal (it waits on its own test's exit, so it slows under load just as
// the test's death does: 20 s would flake where 60 s holds). A tool that does not kill waits out its test (180 s, or about 300 s while a child it started still runs), so
// this still goes red on a missed kill.
const END_WITHIN_MS = 60000;
// Review 2: the tool's exit, or TIMED_OUT once END_WITHIN_MS has passed. Awaiting the exit alone hung an arm for up to
// 300 s on a missed kill (the tool waits out its test), so a failing arm now fails at the bound instead.
const TIMED_OUT = { timedOut: true };
/* Review 6: every arm waits on 'close', not 'exit': Node may still hold output at 'exit', so the tool's last line could
   arrive after the match that reads it. The test's own output goes to a file (prove-it-fails.sh, node --test > $_outf),
   so nothing the tool started holds this pipe open past the tool. */
const ended = (exited) => {
  let timer;
  const late = new Promise((r) => { timer = setTimeout(() => r(TIMED_OUT), END_WITHIN_MS); });
  // Review 3: cancelled once the race settles, or the pending timer held the file open 60 s after every arm.
  return Promise.race([exited, late]).finally(() => clearTimeout(timer));
};
// Review 3: start-up is slowed by load just as death is, so every wait for something to START shares a 60 s bound.
const START_WAIT_MS = 60000;
// Review 4: a pid in a file, or 0 while the file is missing or still empty (seen between create and write).
const pidIn = (file) => { try { const n = Number(fs.readFileSync(file, 'utf8')); return Number.isInteger(n) && n > 0 ? n : 0; } catch { return 0; } };
async function waitFor(cond) { for (const end = Date.now() + START_WAIT_MS; Date.now() < end && !cond();) await sleep(50); return cond(); }
// Review 2: what an arm leaves when it fails before the tool kills its tree: SIGKILL reaches only the bash tool, never
// what it started, so each process the arm recorded is woken (it may have been stopped mid-read) and ended too.
/* Review 5: the live tree under a pid, read before anything is killed (children read one level at a time with pgrep -P,
   each read at once). A failed arm walks the tool's own tree, so its subshell, the test, its runner and anything they
   started are all ended, not only the pids the arm happened to record. */
/* Review 8: one ps read for the whole tree, walked in memory. One pgrep per process took long enough under load for the
   forker arm's signal to land on a finished tree, so that arm stopped testing the race it is named for. */
function treeOf(pid) {
  const kids = new Map();
  try {
    for (const line of execFileSync('/bin/ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' }).split('\n')) {
      const [c, pp] = line.trim().split(/\s+/).map(Number);
      if (c > 0 && pp > 0) { if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push(c); }
    }
  } catch { return []; }
  const out = [];
  const walk = (p) => { for (const k of kids.get(p) || []) { out.push(k); walk(k); } };
  walk(pid);
  return out;
}
/* Review 6: a passing arm has confirmed every pid it recorded is gone, so a cleanup then could only reach a pid the
   system has since given to someone else on this shared Mac. Each arm sets passed as its last line, and its pid-list
   cleanups run only when it did not. */
/* Review 7: and only a pid that is still one of the kinds these arms start (sleep, node, bash): a failing arm can run
   its cleanup seconds after the tool ended everything, by which time a freed pid may be another agent's process. */
const OURS = new Set(['sleep', 'node', 'bash']);
function ours(pid) { try { return OURS.has(path.basename(execFileSync('/bin/ps', ['-o', 'comm=', '-p', String(pid)], { encoding: 'utf8' }).trim())); } catch { return false; } }
function endAll(pids) { for (const p of pids) { if (p && alive(p) && ours(p)) { try { process.kill(p, 'SIGCONT'); process.kill(p, 'SIGTERM'); } catch { /* gone */ } } } }
async function waitGone(pids) { for (const end = Date.now() + DIE_WAIT_MS; Date.now() < end && pids.some(alive);) await sleep(50); return pids.filter(alive); }

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pif-7619-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'tools'));
  fs.copyFileSync(SCRIPT, path.join(dir, 'tools', 'prove-it-fails.sh'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'const x = 1;\n');
  fs.writeFileSync(path.join(dir, 'b.js'), 'const y = 1;\n');   // a colleague's file, edited during one run
  // The test the tool runs: it records its pid, then holds for 180 s, past the signal plus END_WITHIN_MS plus DIE_WAIT_MS.
  fs.writeFileSync(path.join(dir, 'slow.test.js'),
    "require('node:fs').writeFileSync(__dirname + '/runner.pid', String(process.ppid));\n" +
    "require('node:fs').writeFileSync(__dirname + '/test.pid', String(process.pid));\n" +
    "require('node:test')('slow', () => new Promise((r) => setTimeout(r, 180000)));\n");
  const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { stdio: 'ignore' });
  git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'base');
  return dir;
}

// Exit 128 + the signal's number, as a shell reports a death by that signal (review 2: TERM is not an interrupt).
for (const [sig, want, colleague] of [['SIGTERM', 143, false], ['SIGHUP', 129, false], ['SIGINT', 130, false], ['SIGTERM', 143, true]]) {
  test(`#7619 a ${sig} while the test runs restores the broken file and ends the test${colleague ? ', and leaves a colleague\'s edit alone' : ''}`, async (t) => {
    let passed = false;
    const dir = sandbox(t);
    // Without the outer runner's context, or the inner node --test reads itself as nested and runs nothing.
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    // /bin/bash: macOS's own bash 3.2, the one the script's shebang names (an empty array under set -u differs there).
    const child = spawn('/bin/bash', ['tools/prove-it-fails.sh', 'slow.test.js', 'break x', "s = s.replace('x = 1', 'x = 2')"],
      { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env });
  // Review 1 to 5: a failed arm ends the tool's whole live tree (walked first), then the tool itself.
  t.after(() => { if (child.exitCode === null && child.signalCode === null) { const tree = treeOf(child.pid); child.kill('SIGKILL'); endAll(tree); } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const exited = new Promise((r) => child.on('close', (code, signal) => r({ code, signal })));
    // Wait until the break is in the tree AND its test is running: then the signal lands mid-run.
    const pidFile = path.join(dir, 'test.pid');
    await waitFor(() => pidIn(pidFile) > 0);
    assert.ok(pidIn(pidFile) > 0, 'premise: the slow test started: ' + out);
    assert.equal(fs.readFileSync(path.join(dir, 'a.js'), 'utf8'), 'const x = 2;\n', 'premise: the break was applied');
    const testPid = Number(fs.readFileSync(pidFile, 'utf8'));
    const runnerPid = pidIn(path.join(dir, 'runner.pid'));   // review 4: read now, the sandbox goes first
    assert.ok(runnerPid > 0, 'premise: the runner recorded its pid');   // review 6: it is checked gone below, and alive(0) is always true
    t.after(() => { if (!passed) endAll([testPid, runnerPid]); });
    if (colleague) fs.writeFileSync(path.join(dir, 'b.js'), 'const y = 2;   // edited by someone else mid-run\n');
    // Review 7: the tool's tree as the signal lands, ended if the arm fails (a tool that exits without ending its test
    // skips the tool-tree hook above, and its test would hold for 180 s).
    const atSignal = treeOf(child.pid);
    t.after(() => { if (!passed) endAll(atSignal); });
    child.kill(sig);
    const end = await ended(exited);
    // Review 2: timed from the signal (not from spawn, whose start-up time is not the tool's), and raced, so a missed kill
    // fails here at the bound instead of hanging the arm while the tool waits out its test.
    assert.notEqual(end, TIMED_OUT, 'it waited for the 180 s test instead of restoring at once: ' + out);
    const { code } = end;
    assert.equal(fs.readFileSync(path.join(dir, 'a.js'), 'utf8'), 'const x = 1;\n', 'the break was left in the tree: ' + out);
    // The tool's own pid file is untracked; everything tracked is back.
    assert.equal(execFileSync('git', ['-C', dir, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }), colleague ? ' M b.js\n' : '');
    if (colleague) assert.equal(fs.readFileSync(path.join(dir, 'b.js'), 'utf8'), 'const y = 2;   // edited by someone else mid-run\n', 'a colleague\'s edit was wiped');
    assert.equal(code, want, 'exit status: ' + out);
    assert.match(out, /interrupted: restored \(clean\)/);
    // Up to DIE_WAIT_MS: on a loaded machine the per-file test process can take a while to go (2 s and then 10 s flaked).
    // Review 6: and the node --test runner too, or a tool that ends only the test file's process passes.
    assert.deepEqual(await waitGone([testPid, runnerPid]), [], 'the test it was running, or its runner, was left going');
    passed = true;
  });
}

test('#7619 an ordinary run (no signal) still restores the break, through the same path-limited restore', (t) => {
  const dir = sandbox(t);
  // A test that reads the file and goes red on the break.
  fs.writeFileSync(path.join(dir, 'quick.test.js'),
    "require('node:test')('quick', () => { require('node:assert').match(require('node:fs').readFileSync(__dirname + '/a.js', 'utf8'), /x = [1]/); });   // [1], so the break's own replace cannot rewrite this file too\n");
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'quick'], { stdio: 'ignore' });
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  // A colleague's edit to another tracked file, made before the tool's final restore (the tool reads b.js only at its
  // start, through git ls-files, and the edit lands after): it must survive the restore (review 4).
  fs.writeFileSync(path.join(dir, 'quick.test.js'), fs.readFileSync(path.join(dir, 'quick.test.js'), 'utf8') +
    "require('node:fs').writeFileSync(__dirname + '/b.js', 'const y = 9;   // a colleague\\n');\n");
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-am', 'quick edits b'], { stdio: 'ignore' });
  const out = execFileSync('/bin/bash', ['tools/prove-it-fails.sh', 'quick.test.js', 'break x', "s = s.replace('x = 1', 'x = 2')"],
    { cwd: dir, env, encoding: 'utf8', timeout: END_WITHIN_MS });   // review 7: a hung tool fails this arm, not the file
  assert.equal(fs.readFileSync(path.join(dir, 'b.js'), 'utf8'), 'const y = 9;   // a colleague\n', 'the end-of-run restore wiped a file the break never touched');
  assert.match(out, /✖ quick/, 'premise: the break turned the test red: ' + out);
  assert.match(out, /restored\s*$/, out);
  assert.doesNotMatch(out, /NOT restored/, out);
  assert.equal(fs.readFileSync(path.join(dir, 'a.js'), 'utf8'), 'const x = 1;\n');
  assert.equal(execFileSync('git', ['-C', dir, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }), ' M b.js\n');
});

test('#7619 review 3: a TERM after the break is written but before it is recorded still restores it', async (t) => {
  let passed = false;
  const dir = sandbox(t);
  const env = { ...process.env, PIF_TEST_PAUSE_AFTER_BREAK: '8' }; delete env.NODE_TEST_CONTEXT;
  const child = spawn('/bin/bash', ['tools/prove-it-fails.sh', 'slow.test.js', 'break x', "s = s.replace('x = 1', 'x = 2')"],
    { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env });
  // Review 1 to 5: a failed arm ends the tool's whole live tree (walked first), then the tool itself.
  t.after(() => { if (child.exitCode === null && child.signalCode === null) { const tree = treeOf(child.pid); child.kill('SIGKILL'); endAll(tree); } });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const exited = new Promise((r) => child.on('close', (code) => r(code)));
  // Review 3: the break must appear while the tool's pause (8 s: widened from 3 s for load, cut from 20 s in review 6, since bash runs the trap only after
  // the pause's sleep ends and so the arm always waits it out) is still open.
  await waitFor(() => fs.readFileSync(path.join(dir, 'a.js'), 'utf8') === 'const x = 2;\n');
  assert.equal(fs.readFileSync(path.join(dir, 'a.js'), 'utf8'), 'const x = 2;\n', 'premise: the break was written');
  assert.equal(fs.existsSync(path.join(dir, 'test.pid')), false, 'premise: the test has not started (still in the window)');
  const atSignal = treeOf(child.pid);   // review 7, as the signal arms
  t.after(() => { if (!passed) endAll(atSignal); });
  child.kill('SIGTERM');
  const end = await ended(exited);
  assert.notEqual(end, TIMED_OUT, 'the tool did not end within END_WITHIN_MS of the signal: ' + out);
  assert.equal(end, 143, out);
  assert.equal(fs.readFileSync(path.join(dir, 'a.js'), 'utf8'), 'const x = 1;\n', 'the break was left in the tree: ' + out);
  assert.match(out, /interrupted while the break was being written: restored \(clean\)/);
  passed = true;
});

test('#7619 review 3: a broken file someone edits again mid-run is left alone and named, not overwritten', async (t) => {
  let passed = false;
  const dir = sandbox(t);
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = spawn('/bin/bash', ['tools/prove-it-fails.sh', 'slow.test.js', 'break x', "s = s.replace('x = 1', 'x = 2')"],
    { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env });
  // Review 1 to 5: a failed arm ends the tool's whole live tree (walked first), then the tool itself.
  t.after(() => { if (child.exitCode === null && child.signalCode === null) { const tree = treeOf(child.pid); child.kill('SIGKILL'); endAll(tree); } });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const exited = new Promise((r) => child.on('close', (code) => r(code)));
  const pidFile = path.join(dir, 'test.pid');
  await waitFor(() => pidIn(pidFile) > 0);
  assert.ok(pidIn(pidFile) > 0, 'premise: the slow test started: ' + out);
  const slowPid = Number(fs.readFileSync(pidFile, 'utf8'));   // read NOW: the sandbox is gone before t.after runs
  const slowRunner = pidIn(path.join(dir, 'runner.pid'));
  assert.ok(slowRunner > 0, 'premise: the runner recorded its pid');
  t.after(() => { if (!passed) endAll([slowPid, slowRunner]); });   // review 3 and 4: its test and runner too, if the arm fails
  fs.writeFileSync(path.join(dir, 'a.js'), 'const x = 3;   // a colleague, mid-run\n');
  const atSignal = treeOf(child.pid);   // review 7, as the signal arms
  t.after(() => { if (!passed) endAll(atSignal); });
  child.kill('SIGTERM');
  const end = await ended(exited);
  assert.notEqual(end, TIMED_OUT, 'the tool did not end within END_WITHIN_MS of the signal: ' + out);
  assert.equal(end, 143, out);
  assert.equal(fs.readFileSync(path.join(dir, 'a.js'), 'utf8'), 'const x = 3;   // a colleague, mid-run\n', 'their edit was overwritten');
  assert.match(out, /NOT restored, changed again during the run \(check by hand\): a\.js/);
  // Review 4: and its test is gone, or a tool that restores and exits without killing its test passes this arm.
  assert.deepEqual(await waitGone([slowPid, slowRunner]), [], 'the test it was running, or its runner, was left going');
  passed = true;
});

test('#7629 B1: a signal also ends what the test itself started (a child it spawned is not left running)', async (t) => {
  let passed = false;
  const dir = sandbox(t);
  // A test that starts a long-running child of its own (as a test server would), records its pid, then holds.
  fs.writeFileSync(path.join(dir, 'kids.test.js'),
    "const { spawn } = require('node:child_process');\n" +
    "const k = spawn('/bin/sleep', ['300'], { stdio: 'ignore' });\n" +
    "require('node:fs').writeFileSync(__dirname + '/kid.pid', String(k.pid));\n" +
    "require('node:test')('holds', () => new Promise((r) => setTimeout(r, 180000)));\n");
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'kids'], { stdio: 'ignore' });
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = spawn('/bin/bash', ['tools/prove-it-fails.sh', 'kids.test.js', 'break x', "s = s.replace('x = 1', 'x = 2')"],
    { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env });
  // Review 1 to 5: a failed arm ends the tool's whole live tree (walked first), then the tool itself.
  t.after(() => { if (child.exitCode === null && child.signalCode === null) { const tree = treeOf(child.pid); child.kill('SIGKILL'); endAll(tree); } });
  const exited = new Promise((r) => child.on('close', (code) => r(code)));
  const kidFile = path.join(dir, 'kid.pid');
  await waitFor(() => pidIn(kidFile) > 0);
  assert.ok(pidIn(kidFile) > 0, 'premise: the test started its child');
  const kid = Number(fs.readFileSync(kidFile, 'utf8'));
  t.after(() => { if (!passed) endAll([kid]); });   // never leave it behind, even when the arm fails (woken first: it may be stopped)
  assert.ok(alive(kid), 'premise: the child is running');
  const atSignal = treeOf(child.pid);   // review 7, as the signal arms
  t.after(() => { if (!passed) endAll(atSignal); });
  child.kill('SIGTERM');
  const end = await ended(exited);
  assert.notEqual(end, TIMED_OUT, 'the tool waited for its test instead of ending it at once');
  assert.equal(end, 143);
  // Review (10-31 mutant): the tool must end at once, not after its test does. Without this a broken kill passed:
  // the tool waited out the test, its children had ended by themselves, and the left-running check read clean.
  assert.deepEqual(await waitGone([kid]), [], 'the child the test started was left running');
  assert.equal(fs.readFileSync(path.join(dir, 'a.js'), 'utf8'), 'const x = 1;\n');
  passed = true;
});

test('#7629 B1 review 2: a child that keeps forking leaves nothing behind (the tree is stopped as it is read)', async (t) => {
  let passed = false;
  const dir = sandbox(t);
  // A child that forks a new long sleeper every 50 ms and records each pid: without the STOP, the ones it forks
  // between the handler's read and its kill would escape. 🛑 CAPPED at 50, then it waits holding them (exiting would
  // orphan them out of the tree the tool kills). Uncapped, a tool whose kill is broken lets this fork until the test
  // ends: on 10-31 a mutant did exactly that, about 3,300 sleeps, and the shared Mac hit its per-user process limit
  // and other agents' runs failed to fork. The signal lands at 5 or more (forks are 50 ms apart, so 45 forks, over
  // 2 s, stand between it and the cap), and the arm checks fewer than 50 are out before it fires.
  // The pid list lives in its own folder, not the sandbox: t.after hooks run in the order they were added, and the
  // sandbox's removal runs first, so a list inside it was gone before the cleanup read it (10-31: 50 sleeps left).
  const pidsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pif-7629-pids-'));
  const pidsFile = path.join(pidsDir, 'forked.pids');
  fs.writeFileSync(path.join(dir, 'forker.sh'),
    '#!/bin/bash\nn=0; while [ $n -lt 50 ]; do /bin/sleep 300 & echo $! >> "$1"; n=$((n + 1)); /bin/sleep 0.05; done; wait\n');
  fs.chmodSync(path.join(dir, 'forker.sh'), 0o755);
  fs.writeFileSync(path.join(dir, 'fork.test.js'),
    "const { spawn } = require('node:child_process');\n" +
    "const fk = spawn(__dirname + '/forker.sh', [" + JSON.stringify(pidsFile) + "], { stdio: 'ignore' });\n" +
    "require('node:fs').writeFileSync(" + JSON.stringify(pidsFile + '.forker') + ", String(fk.pid));\n" +
    "require('node:test')('holds', () => new Promise((r) => setTimeout(r, 180000)));\n");
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'forker'], { stdio: 'ignore' });
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = spawn('/bin/bash', ['tools/prove-it-fails.sh', 'fork.test.js', 'break x', "s = s.replace('x = 1', 'x = 2')"],
    { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env });
  // Review 1 to 5: a failed arm ends the tool's whole live tree (walked first), then the tool itself.
  t.after(() => { if (child.exitCode === null && child.signalCode === null) { const tree = treeOf(child.pid); child.kill('SIGKILL'); endAll(tree); } });
  const exited = new Promise((r) => child.on('close', (code) => r(code)));
  const read = () => (fs.existsSync(pidsFile) ? fs.readFileSync(pidsFile, 'utf8').split('\n').filter(Boolean).map(Number) : []);
  // Review 3: the forker first (a late forker would go on forking after a short read), then the list, read again.
  const forkerPid = () => { try { return Number(fs.readFileSync(pidsFile + '.forker', 'utf8')); } catch { return 0; } };
  t.after(() => { if (!passed) { endAll([forkerPid()]); endAll(read()); } });   // never leave sleepers behind (woken first: a read cut short leaves them stopped)
  t.after(() => fs.rmSync(pidsDir, { recursive: true, force: true }));   // after the cleanup has read it
  await waitFor(() => read().length >= 5);
  assert.ok(read().length >= 5, 'premise: the forker is forking');
  // Review: and still forking when the signal lands (under 50, its cap), or the arm proves only a static tree.
  assert.ok(read().length < 50, 'premise: the forker had already finished before the signal (' + read().length + ' pids)');
  const atSignal = treeOf(child.pid);   // review 7, as the signal arms
  t.after(() => { if (!passed) endAll(atSignal); });
  child.kill('SIGTERM');
  const end = await ended(exited);
  assert.notEqual(end, TIMED_OUT, 'the tool waited for its test instead of ending it at once');
  assert.equal(end, 143);
  // Review (10-31 mutant): the tool must end at once, not after its test does. Without this a broken kill passed:
  // the tool waited out the test, its children had ended by themselves, and the left-running check read clean.
  // Anything that escaped sleeps 300 s, so it is still alive when the wait ends; a slow death under load is not an escape.
  // Review 8: the forker itself too (a tool that misses it leaves it forking), and the list read again once it is gone, so
  // a sleep it forked after the first read is checked as well.
  const left = await waitGone([forkerPid(), ...read()].filter(Boolean));
  assert.deepEqual(left, [], 'forked processes (or the forker) left running: ' + left.length);
  const late = await waitGone(read());
  assert.deepEqual(late, [], 'processes forked after the first read left running: ' + late.length);
  passed = true;
});

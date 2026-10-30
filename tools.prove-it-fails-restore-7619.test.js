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

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pif-7619-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'tools'));
  fs.copyFileSync(SCRIPT, path.join(dir, 'tools', 'prove-it-fails.sh'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'const x = 1;\n');
  fs.writeFileSync(path.join(dir, 'b.js'), 'const y = 1;\n');   // a colleague's file, edited during one run
  // The test the tool runs: it records its pid, then holds for 30 s, far past the point the signal arrives.
  fs.writeFileSync(path.join(dir, 'slow.test.js'),
    "require('node:fs').writeFileSync(__dirname + '/test.pid', String(process.pid));\n" +
    "require('node:test')('slow', () => new Promise((r) => setTimeout(r, 30000)));\n");
  const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { stdio: 'ignore' });
  git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'base');
  return dir;
}

// Exit 128 + the signal's number, as a shell reports a death by that signal (review 2: TERM is not an interrupt).
for (const [sig, want, colleague] of [['SIGTERM', 143, false], ['SIGHUP', 129, false], ['SIGINT', 130, false], ['SIGTERM', 143, true]]) {
  test(`#7619 a ${sig} while the test runs restores the broken file and ends the test${colleague ? ', and leaves a colleague\'s edit alone' : ''}`, async (t) => {
    const dir = sandbox(t);
    // Without the outer runner's context, or the inner node --test reads itself as nested and runs nothing.
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const started = Date.now();
    // /bin/bash: macOS's own bash 3.2, the one the script's shebang names (an empty array under set -u differs there).
    const child = spawn('/bin/bash', ['tools/prove-it-fails.sh', 'slow.test.js', 'break x', "s = s.replace('x = 1', 'x = 2')"],
      { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));
    // Wait until the break is in the tree AND its test is running: then the signal lands mid-run.
    const pidFile = path.join(dir, 'test.pid');
    for (let i = 0; i < 200 && !fs.existsSync(pidFile); i++) await sleep(50);
    assert.ok(fs.existsSync(pidFile), 'premise: the slow test started: ' + out);
    assert.equal(fs.readFileSync(path.join(dir, 'a.js'), 'utf8'), 'const x = 2;\n', 'premise: the break was applied');
    const testPid = Number(fs.readFileSync(pidFile, 'utf8'));
    if (colleague) fs.writeFileSync(path.join(dir, 'b.js'), 'const y = 2;   // edited by someone else mid-run\n');
    child.kill(sig);
    const { code } = await exited;
    assert.equal(fs.readFileSync(path.join(dir, 'a.js'), 'utf8'), 'const x = 1;\n', 'the break was left in the tree: ' + out);
    // The tool's own pid file is untracked; everything tracked is back.
    assert.equal(execFileSync('git', ['-C', dir, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }), colleague ? ' M b.js\n' : '');
    if (colleague) assert.equal(fs.readFileSync(path.join(dir, 'b.js'), 'utf8'), 'const y = 2;   // edited by someone else mid-run\n', 'a colleague\'s edit was wiped');
    assert.equal(code, want, 'exit status: ' + out);
    assert.match(out, /interrupted: restored \(clean\)/);
    assert.ok(Date.now() - started < 20000, 'it waited for the 30 s test instead of restoring at once');
    // Up to 10 s: on a loaded machine the per-file test process can take a while to go (a 2 s bound flaked).
    for (let i = 0; i < 200 && alive(testPid); i++) await sleep(50);
    assert.equal(alive(testPid), false, 'the test it was running was left going');
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
    { cwd: dir, env, encoding: 'utf8' });
  assert.equal(fs.readFileSync(path.join(dir, 'b.js'), 'utf8'), 'const y = 9;   // a colleague\n', 'the end-of-run restore wiped a file the break never touched');
  assert.match(out, /✖ quick/, 'premise: the break turned the test red: ' + out);
  assert.match(out, /restored\s*$/, out);
  assert.doesNotMatch(out, /NOT restored/, out);
  assert.equal(fs.readFileSync(path.join(dir, 'a.js'), 'utf8'), 'const x = 1;\n');
  assert.equal(execFileSync('git', ['-C', dir, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }), ' M b.js\n');
});

test('#7619 review 3: a TERM after the break is written but before it is recorded still restores it', async (t) => {
  const dir = sandbox(t);
  const env = { ...process.env, PIF_TEST_PAUSE_AFTER_BREAK: '3' }; delete env.NODE_TEST_CONTEXT;
  const child = spawn('/bin/bash', ['tools/prove-it-fails.sh', 'slow.test.js', 'break x', "s = s.replace('x = 1', 'x = 2')"],
    { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const exited = new Promise((r) => child.on('exit', (code) => r(code)));
  for (let i = 0; i < 100 && fs.readFileSync(path.join(dir, 'a.js'), 'utf8') !== 'const x = 2;\n'; i++) await sleep(50);
  assert.equal(fs.readFileSync(path.join(dir, 'a.js'), 'utf8'), 'const x = 2;\n', 'premise: the break was written');
  assert.equal(fs.existsSync(path.join(dir, 'test.pid')), false, 'premise: the test has not started (still in the window)');
  child.kill('SIGTERM');
  assert.equal(await exited, 143, out);
  assert.equal(fs.readFileSync(path.join(dir, 'a.js'), 'utf8'), 'const x = 1;\n', 'the break was left in the tree: ' + out);
  assert.match(out, /interrupted while the break was being written: restored \(clean\)/);
});

test('#7619 review 3: a broken file someone edits again mid-run is left alone and named, not overwritten', async (t) => {
  const dir = sandbox(t);
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = spawn('/bin/bash', ['tools/prove-it-fails.sh', 'slow.test.js', 'break x', "s = s.replace('x = 1', 'x = 2')"],
    { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const exited = new Promise((r) => child.on('exit', (code) => r(code)));
  const pidFile = path.join(dir, 'test.pid');
  for (let i = 0; i < 200 && !fs.existsSync(pidFile); i++) await sleep(50);
  assert.ok(fs.existsSync(pidFile), 'premise: the slow test started: ' + out);
  fs.writeFileSync(path.join(dir, 'a.js'), 'const x = 3;   // a colleague, mid-run\n');
  child.kill('SIGTERM');
  assert.equal(await exited, 143, out);
  assert.equal(fs.readFileSync(path.join(dir, 'a.js'), 'utf8'), 'const x = 3;   // a colleague, mid-run\n', 'their edit was overwritten');
  assert.match(out, /NOT restored, changed again during the run \(check by hand\): a\.js/);
});

test('#7629 B1: a signal also ends what the test itself started (a child it spawned is not left running)', async (t) => {
  const dir = sandbox(t);
  // A test that starts a long-running child of its own (as a test server would), records its pid, then holds.
  fs.writeFileSync(path.join(dir, 'kids.test.js'),
    "const { spawn } = require('node:child_process');\n" +
    "const k = spawn('/bin/sleep', ['60'], { stdio: 'ignore' });\n" +
    "require('node:fs').writeFileSync(__dirname + '/kid.pid', String(k.pid));\n" +
    "require('node:test')('holds', () => new Promise((r) => setTimeout(r, 30000)));\n");
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'kids'], { stdio: 'ignore' });
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = spawn('/bin/bash', ['tools/prove-it-fails.sh', 'kids.test.js', 'break x', "s = s.replace('x = 1', 'x = 2')"],
    { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env });
  const exited = new Promise((r) => child.on('exit', (code) => r(code)));
  const kidFile = path.join(dir, 'kid.pid');
  for (let i = 0; i < 200 && !fs.existsSync(kidFile); i++) await sleep(50);
  assert.ok(fs.existsSync(kidFile), 'premise: the test started its child');
  const kid = Number(fs.readFileSync(kidFile, 'utf8'));
  t.after(() => { if (alive(kid)) process.kill(kid); });   // never leave it behind, even when the arm fails
  assert.ok(alive(kid), 'premise: the child is running');
  child.kill('SIGTERM');
  assert.equal(await exited, 143);
  for (let i = 0; i < 200 && alive(kid); i++) await sleep(50);
  assert.equal(alive(kid), false, 'the child the test started was left running');
  assert.equal(fs.readFileSync(path.join(dir, 'a.js'), 'utf8'), 'const x = 1;\n');
});

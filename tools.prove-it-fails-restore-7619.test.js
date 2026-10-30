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
  // The test the tool runs: it records its pid, then holds for 30 s, far past the point the signal arrives.
  fs.writeFileSync(path.join(dir, 'slow.test.js'),
    "require('node:fs').writeFileSync(__dirname + '/test.pid', String(process.pid));\n" +
    "require('node:test')('slow', () => new Promise((r) => setTimeout(r, 30000)));\n");
  const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { stdio: 'ignore' });
  git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'base');
  return dir;
}

for (const sig of ['SIGTERM', 'SIGHUP']) {
  test(`#7619 a ${sig} while the test runs restores the broken file and ends the test`, async (t) => {
    const dir = sandbox(t);
    // Without the outer runner's context, or the inner node --test reads itself as nested and runs nothing.
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const started = Date.now();
    const child = spawn('bash', ['tools/prove-it-fails.sh', 'slow.test.js', 'break x', "s = s.replace('x = 1', 'x = 2')"],
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
    child.kill(sig);
    const { code } = await exited;
    assert.equal(fs.readFileSync(path.join(dir, 'a.js'), 'utf8'), 'const x = 1;\n', 'the break was left in the tree: ' + out);
    // The tool's own pid file is untracked; everything tracked is back.
    assert.equal(execFileSync('git', ['-C', dir, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }), '');
    assert.equal(code, 130, 'exit status: ' + out);
    assert.match(out, /interrupted: restored \(clean\)/);
    assert.ok(Date.now() - started < 20000, 'it waited for the 30 s test instead of restoring at once');
    for (let i = 0; i < 40 && alive(testPid); i++) await sleep(50);
    assert.equal(alive(testPid), false, 'the test it was running was left going');
  });
}

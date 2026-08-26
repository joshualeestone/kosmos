'use strict';
/**
 * #923: the real board process pins its own cwd to $HOME at startup, so a
 * directory it happened to be launched from (a .pkg installer's temporary
 * staging directory, a git worktree later removed) going away underneath
 * it cannot break anything that later relies on process.cwd() -- most
 * concretely, engine/connect.js's `run()` spawning `<claude> install`
 * without its own explicit cwd override.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { execFileSync } = require('node:child_process');

test('#923: the board process chdirs to $HOME at startup, so a directory it was launched from can be removed without stranding its cwd', async () => {
  const launchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cwd-'));
  const dataDir = path.join(launchDir, 'data');
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    cwd: launchDir,
    env: {
      ...process.env,
      PORT: '0',
      AGENT_WORKFORCE_DATA: dataDir,
      AGENT_WORKFORCE_PROJECTS: path.join(launchDir, 'projects'),
      AGENT_WORKFORCE_WORKERS: path.join(launchDir, 'workers'),
      AGENT_WORKFORCE_LAUNCH: path.join(launchDir, 'launch'),
      AGENT_WORKFORCE_DRY_RUN: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (c) => { stdout += c; });
  try {
    // Wait for the real startup banner ("Kosmos on http://...") rather
    // than a fixed sleep, so this is not a timing guess.
    const upAt = Date.now();
    while (!/Kosmos on http/.test(stdout)) {
      if (Date.now() - upAt > 15000) throw new Error('server did not report startup in time: ' + stdout);
      await new Promise((r) => setTimeout(r, 50));
    }
    // lsof, not a debug endpoint this file would need to invent: the
    // process's own cwd is an OS-level fact, and this is the same tool
    // used to trace the original bug live.
    const lsofOut = execFileSync('/usr/sbin/lsof', ['-p', String(child.pid)], { encoding: 'utf8' });
    const cwdLine = lsofOut.split('\n').find((l) => /\bcwd\b/.test(l));
    assert.ok(cwdLine, 'lsof reported no cwd entry for the child process: ' + lsofOut);
    assert.ok(
      cwdLine.includes(os.homedir()),
      'the board process\'s cwd is not $HOME (' + os.homedir() + '): ' + cwdLine
    );
    assert.ok(
      !cwdLine.includes(launchDir),
      'the board process is still pinned to the directory it was launched from, which #923 is about removing safely: ' + cwdLine
    );
  } finally {
    child.kill('SIGKILL');
    await new Promise((r) => { child.on('exit', r); setTimeout(r, 2000); });
    fs.rmSync(launchDir, { recursive: true, force: true });
  }
});

test('#923: reproduces the precise failure -- a child spawned without an explicit cwd inherits a deleted one from its parent and fails at its OWN startup, the way `claude install` did', async () => {
  // engine/connect.js's run() is internal (not exported) and driving the
  // full download+install flow is too heavy for a unit test, so this
  // isolates the actual OS-level mechanism instead: a child process does
  // NOT fail to spawn from a deleted cwd (fork() inherits it by file
  // descriptor, no path-string lookup needed) -- what fails is the CHILD
  // itself calling process.cwd() at its own startup, exactly what a real
  // CLI binary like `claude` does. Run as a subprocess of a subprocess
  // (via a small script) because this test's OWN process must not have
  // its cwd deleted out from under it.
  const script = `
    const { execFile } = require('node:child_process');
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const util = require('node:util');
    const run = util.promisify(execFile);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cwdkill-'));
    process.chdir(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    const childScript = 'try { process.cwd(); process.exit(0); } catch (e) { process.stderr.write(e.message); process.exit(1); }';
    (async () => {
      let before;
      try { await run(process.execPath, ['-e', childScript]); before = 'succeeded'; }
      catch (e) { before = 'failed: ' + (e.stderr || e.message); }
      process.chdir(os.homedir());
      let after;
      try { await run(process.execPath, ['-e', childScript]); after = 'succeeded'; }
      catch (e) { after = 'failed: ' + (e.stderr || e.message); }
      process.stdout.write(JSON.stringify({ before, after }));
    })();
  `;
  const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  const { before, after } = JSON.parse(out);
  assert.match(
    before,
    /^failed: .*process\.cwd/,
    'a child spawned without an explicit cwd, from a parent whose cwd was deleted, should fail the way `claude install` did for Josh -- got: ' + before
  );
  assert.equal(
    after,
    'succeeded',
    'once the parent chdir()s to $HOME (this fix), the same spawn should succeed -- got: ' + after
  );
});

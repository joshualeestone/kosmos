'use strict';
/*
 * #4326: test-support/tool-guard.js refuses a REAL gh / vercel / cloudflared and fails the file.
 * Nothing real is ever spawned here: every child that might reach a tool runs with an EMPTY PATH,
 * so even a guard that regressed could not find the operator's install, and the fakes it allows
 * are this repo's own.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const util = require('node:util');
const { spawnSync } = require('node:child_process');

const GUARD = path.join(__dirname, 'test-support', 'tool-guard.js');
const FAKE = path.join(__dirname, 'test-support', 'fake-cli-signed-out.sh');
const { refusedTool, realToolInScript } = require('./test-support/tool-guard');

test('#4326 the guard names a real CLI and leaves the fakes alone', () => {
  assert.equal(refusedTool('vercel'), 'vercel', 'a bare name resolves to the operator\'s install');
  assert.equal(refusedTool('gh'), 'gh');
  assert.equal(refusedTool('/opt/homebrew/bin/vercel'), 'vercel');
  assert.equal(refusedTool('/usr/local/bin/cloudflared'), 'cloudflared');
  assert.equal(refusedTool(FAKE), null, 'the repo\'s own fake is not a real CLI');
  assert.equal(refusedTool('/bin/echo'), null, 'another tool is none of the guard\'s business');
  assert.equal(refusedTool(path.join(os.tmpdir(), 'x', 'gh')), null, 'a fake under the temp dir is allowed');
  // A relative path resolves against the CALL's cwd, the way the spawn will (review finding).
  assert.equal(refusedTool('./vercel', os.tmpdir()), null, './vercel in a temp dir is a fake');
  assert.equal(refusedTool('./vercel', '/opt/homebrew/bin'), 'vercel');
});

test('#4326 shell commands are checked at command position, not in arguments', () => {
  assert.equal(realToolInScript('vercel whoami'), 'vercel');
  assert.equal(realToolInScript('cd /x && gh auth status'), 'gh');
  assert.equal(realToolInScript('FOO=1 env A=b vercel ls'), 'vercel');
  assert.equal(realToolInScript('echo $(gh api user)'), 'gh');
  assert.equal(realToolInScript('git commit -m "fix the gh door"'), null, 'a tool named in an argument must not be refused');
  assert.equal(realToolInScript('ls | grep vercel'), null);
  assert.equal(realToolInScript('"$TMPDIR"/fake/gh x', undefined, { TMPDIR: os.tmpdir() }), null, 'a variable-built fake path resolves');
});

test('#4326 promisify(execFile) keeps its { stdout, stderr } shape under the guard', async () => {
  // The guard wraps execFile; without its util.promisify.custom, promisify falls back to the
  // generic form and resolves a bare string, which breaks every `const { stdout } = await run()`.
  require('./test-support/tool-guard');
  const run = util.promisify(require('node:child_process').execFile);
  const r = await run('/bin/echo', ['hi']);
  assert.equal(typeof r, 'object', 'promisify(execFile) resolved a bare value, not { stdout, stderr }');
  assert.equal(r.stdout, 'hi\n');
  assert.equal(r.stderr, '');
});

// A test FILE whose own test passes, because it swallows the refusal exactly as the connections
// sweep swallows a door's error. The guard must still fail the file.
function runFile(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-toolguard-4326-'));
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-toolguard-path-'));
  try {
    const f = path.join(dir, 'probe.test.js');
    fs.writeFileSync(f, "'use strict';\nconst test = require('node:test');\nconst cp = require('node:child_process');\n" +
      "test('swallows it', () => { " + body + " });\n");
    // Without NODE_TEST_CONTEXT: a `node --test` started from inside a test process inherits it
    // and reports to that parent instead of exiting non-zero, so its failure would be invisible.
    // An EMPTY PATH: if the guard ever stopped refusing, a bare `vercel` finds nothing to run.
    const env = { ...process.env, PATH: empty };
    delete env.NODE_TEST_CONTEXT;
    return spawnSync(process.execPath, ['--test', '--require', GUARD, f], { encoding: 'utf8', timeout: 60000, env });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(empty, { recursive: true, force: true });
  }
}

for (const [label, body] of [
  ['execFile', "try { cp.execFile('vercel', ['whoami'], () => {}); } catch (e) {}"],
  ['exec (a shell string)', "try { cp.exec('vercel whoami', () => {}); } catch (e) {}"],
  ['spawnSync with shell: true', "try { cp.spawnSync('vercel whoami', { shell: true }); } catch (e) {}"],
  ['sh -c', "try { cp.spawnSync('/bin/sh', ['-c', 'vercel x']); } catch (e) {}"],
  ['bash -lc (a login shell)', "try { cp.spawnSync('/bin/bash', ['-lc', 'vercel x']); } catch (e) {}"],
  ['fish -c', "try { cp.spawnSync('fish', ['-c', 'vercel x']); } catch (e) {}"],
  ['cmd /c', "try { cp.spawnSync('cmd.exe', ['/c', 'vercel', 'x']); } catch (e) {}"],
  ['powershell -Command', "try { cp.spawnSync('pwsh', ['-Command', 'vercel x']); } catch (e) {}"],
]) {
  test(`#4326 a file that reaches a real CLI via ${label} FAILS, even when its test swallows the error`, () => {
    const r = runFile(body);
    assert.notEqual(r.status, 0, `the file passed although it reached the real vercel via ${label}`);
    assert.match(r.stdout + r.stderr, /#4326: a test tried to run the REAL vercel/, 'the failure does not say why');
    assert.match(r.stdout + r.stderr, /AGENT_WORKFORCE_VERCEL_BIN/, 'the failure does not name the override to set');
  });
}

test('#4326 control: bash -lc running an ordinary command is NOT refused', () => {
  const r = runFile("const o = cp.spawnSync('/bin/bash', ['-lc', 'echo fine'], { encoding: 'utf8' }); if (o.stdout.trim() !== 'fine') throw new Error('bash -lc did not run: ' + JSON.stringify(o));");
  assert.equal(r.status, 0, `the guard refused an ordinary bash -lc:\n${r.stdout}${r.stderr}`);
});

test('#4326 control: the same file through the repo\'s fake passes, and the fake really ran', () => {
  // Synchronous, so the fake has run before the test ends; it exits 1 ("signed out").
  const r = runFile(`let ran = false; try { cp.execFileSync(${JSON.stringify(FAKE)}, ['whoami'], { stdio: 'ignore' }); } catch (e) { ran = e.status === 1; } if (!ran) throw new Error('the fake did not run');`);
  assert.equal(r.status, 0, `the guard failed a file that only used the fake:\n${r.stdout}${r.stderr}`);
});

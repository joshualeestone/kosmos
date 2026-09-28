'use strict';
/*
 * #4326: test-support/tool-guard.js refuses a REAL gh / vercel / cloudflared and fails the file.
 * Nothing real is ever spawned here: a bare name (no slash) is refused BEFORE any spawn, which
 * exercises the whole refusal path, and the fakes it allows are this repo's own.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GUARD = path.join(__dirname, 'test-support', 'tool-guard.js');
const FAKE = path.join(__dirname, 'test-support', 'fake-cli-signed-out.sh');
const { refusedTool } = require('./test-support/tool-guard');

test('#4326 the guard names a real CLI and leaves the fakes alone', () => {
  assert.equal(refusedTool('vercel'), 'vercel', 'a bare name resolves to the operator\'s install');
  assert.equal(refusedTool('gh'), 'gh');
  assert.equal(refusedTool('/opt/homebrew/bin/vercel'), 'vercel');
  assert.equal(refusedTool('/usr/local/bin/cloudflared'), 'cloudflared');
  assert.equal(refusedTool(FAKE), null, 'the repo\'s own fake is not a real CLI');
  assert.equal(refusedTool('/bin/echo'), null, 'another tool is none of the guard\'s business');
  assert.equal(refusedTool(path.join(os.tmpdir(), 'x', 'gh')), null, 'a fake a test writes under the temp dir is allowed');
});

// A test FILE whose own test passes, because it swallows the refusal exactly as the connections
// sweep swallows a door's error. The guard must still fail the file.
function runFile(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-toolguard-4326-'));
  try {
    const f = path.join(dir, 'probe.test.js');
    fs.writeFileSync(f, "'use strict';\nconst test = require('node:test');\nconst cp = require('node:child_process');\n" +
      "test('swallows it', () => { " + body + " });\n");
    // Without NODE_TEST_CONTEXT: a `node --test` started from inside a test process inherits it
    // and reports to that parent instead of exiting non-zero, so its failure would be invisible.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    return spawnSync(process.execPath, ['--test', '--require', GUARD, f], { encoding: 'utf8', timeout: 60000, env });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('#4326 a file that reaches a real CLI FAILS, even when its test swallows the error', () => {
  const r = runFile("try { cp.execFile('vercel', ['whoami'], () => {}); } catch (e) {}");
  assert.notEqual(r.status, 0, 'the file passed although it reached the real vercel: the guard does not fail it');
  assert.match(r.stdout + r.stderr, /#4326: a test tried to run the REAL vercel/, 'the failure does not say why');
  assert.match(r.stdout + r.stderr, /AGENT_WORKFORCE_VERCEL_BIN/, 'the failure does not name the override to set');
});

test('#4326 control: the same file through the repo\'s fake passes', () => {
  const r = runFile(`cp.execFile(${JSON.stringify(FAKE)}, ['whoami'], () => {});`);
  assert.equal(r.status, 0, `the guard failed a file that only used the fake:\n${r.stdout}${r.stderr}`);
});

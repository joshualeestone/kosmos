'use strict';
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * #8156: a throwaway agent made on a computer that runs test suites reds other people's full validations (the
 * #3011 leak guard), unless it carries the prefix #4392 reserved, which the guard skips. Nothing an agent reads
 * named that prefix, so this pins it where agents look:
 *   1. `kosmos agent --help` on the Mac CLI (install/kosmos) and the Windows CLI (tools/windows/kosmos-cli.js);
 *   2. the #3011 LEAK message in tools/run-tests.sh, which also says to read the names before moving anything out.
 * The prefix is read from the guard itself (tools/lib/launchagent-leak-guard.sh), so the help cannot name one the
 * guard does not skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = __dirname;
const GUARD = fs.readFileSync(path.join(ROOT, 'tools', 'lib', 'launchagent-leak-guard.sh'), 'utf8');
const m = GUARD.match(/^LAUNCHAGENT_LIVECHECK_PREFIX='([^']+)'$/m);
const PREFIX = m && m[1];

test('#8156: the guard declares the reserved prefix this test pins (CONTROL)', () => {
  assert.ok(PREFIX && PREFIX.endsWith('-'), 'the guard no longer declares LAUNCHAGENT_LIVECHECK_PREFIX: ' + PREFIX);   // never spelled out here: the guard's own search refuses a test that names it
  assert.ok(GUARD.includes('! -name "com.kosmos.agent.${LAUNCHAGENT_LIVECHECK_PREFIX}*.plist"'), 'the guard no longer skips the prefix');
});

/* Each CLI's `agent --help`, run with a fresh HOME and no agent token, so nothing on this computer is read. */
function helpOf(cmd, args) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-livecheck-8156-'));
  const r = spawnSync(cmd, args, { cwd: ROOT, env: { PATH: process.env.PATH, HOME: home }, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, args.join(' ') + ' exited ' + r.status + ': ' + r.stderr);
  return r.stdout;
}

for (const [label, cmd, args] of [
  ['the Mac CLI', 'bash', ['install/kosmos', 'agent', '--help']],
  ['the Windows CLI', process.execPath, ['tools/windows/kosmos-cli.js', 'agent', '--help']],
]) {
  test('#8156: ' + label + '\'s agent help names the prefix the leak guard skips', () => {
    const out = helpOf(cmd, args);
    assert.ok(out.includes('kosmos agent create'), 'not the agent help: ' + out);   // CONTROL: the right text was read
    assert.ok(out.includes(PREFIX + '<something>'), label + ' does not name ' + PREFIX + ':\n' + out);
    assert.ok(out.includes('leak guard skips'), out);
  });
}

test('#8156: the #3011 LEAK message names the prefix, and says to read the names before moving anything out', () => {
  const lines = fs.readFileSync(path.join(ROOT, 'tools', 'run-tests.sh'), 'utf8').split('\n').filter((l) => l.includes('#3011 LEAK --'));
  assert.equal(lines.length, 1, 'expected exactly one #3011 LEAK message, found ' + lines.length);
  const msg = lines[0];
  assert.ok(msg.includes(PREFIX + '<something>'), msg);
  const read = msg.indexOf('Read the names and working dirs first');
  const move = msg.indexOf('Move any other out');
  assert.ok(read > 0 && move > read, 'the message must say to read the names before it says to move files out: ' + msg);
});

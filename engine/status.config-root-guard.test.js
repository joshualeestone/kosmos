'use strict';
/**
 * A SANDBOXED FIXTURE MUST NOT READ THE OPERATOR'S REAL AGENTS AND ACCOUNTS.
 *
 * `configRoots()` walked the real `$HOME` whenever AGENT_WORKFORCE_CONFIG_ROOT
 * was unset. #1134 set that variable inside docs/browser-checks/thread-server.js
 * and nowhere else, so tools/browser-checks.sh booted boards that read this
 * machine for weeks, and a documented direct `node docs/browser-checks/x.js`
 * bypasses any harness-level fix entirely. The guard therefore keys on the
 * PROCESS: a data dir under the temp dir plus a real HOME is an inconsistent
 * sandbox, and gets an empty root instead of the operator's.
 *
 * ⚠️ THE THREE SILENT ARMS ARE THE POINT, NOT THE FIRING ONE. A guard that
 * never returns the dangerous answer has not been tested, and one that always
 * returns the safe answer would blind a real user and a real local-board tool.
 * B is the arm that makes A mean anything.
 *
 * 📌 ARM A IS NOT VACUOUS, MEASURED RATHER THAN ASSUMED. The identical
 * condition run against the pre-fix tree (main at 9aa6e5de, which contains no
 * guard) returns the four real roots, so arm A genuinely fails without this
 * change and passes with it. A guard test that has only ever been run against
 * the fixed code has never been shown to be able to fail.
 *
 * Each arm runs in its own child, because status.js reads HOME and the
 * environment once at module load, so mutating process.env in-process would
 * measure the wrong world.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const INNER = 'console.log(JSON.stringify(require("./engine/status.js").configRoots()));';
const TMP_DATA = path.join(os.tmpdir(), 'aw-guard-test', 'data');

function roots(env) {
  const e = { ...process.env };
  delete e.AGENT_WORKFORCE_CONFIG_ROOT;
  delete e.AGENT_WORKFORCE_DATA;
  Object.assign(e, env);
  return JSON.parse(execFileSync('node', ['-e', INNER], { env: e, cwd: REPO }).toString());
}

test('A: a sandboxed data dir with a real HOME is diverted away from the real roots', () => {
  const got = roots({ AGENT_WORKFORCE_DATA: TMP_DATA });
  assert.equal(got.length, 1);
  assert.ok(got[0].startsWith(TMP_DATA), `expected a path under the sandbox, got ${got[0]}`);
  assert.ok(!got.some((r) => r.startsWith(os.homedir() + path.sep + '.claude')),
    'no real config root may survive the diversion');
});

test('B: CONTROL, an ordinary run still reads the real roots', () => {
  // Without this the suite could pass with a guard that blinded everybody.
  const got = roots({});
  assert.ok(got.length >= 1);
  assert.ok(got.every((r) => r.startsWith(os.homedir())),
    `an unsandboxed process must still see its own home, got ${JSON.stringify(got)}`);
  assert.ok(!got.some((r) => r.includes('no-config-root-sandbox')),
    'the guard must not fire for a normal run');
});

test('B2: CONTROL, a production-shaped data dir is not treated as a fixture', () => {
  const got = roots({ AGENT_WORKFORCE_DATA: path.join(os.homedir(), 'Library/Application Support/AgentWorkforce') });
  assert.ok(!got.some((r) => r.includes('no-config-root-sandbox')),
    'Application Support is where the real app stores data and must never divert');
});

test('C: an explicit config root always wins, sandboxed or not', () => {
  const explicit = path.join(os.tmpdir(), 'aw-guard-test', 'mine');
  assert.deepEqual(roots({ AGENT_WORKFORCE_DATA: TMP_DATA, AGENT_WORKFORCE_CONFIG_ROOT: explicit }), [explicit]);
});

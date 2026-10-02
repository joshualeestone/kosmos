'use strict';

/**
 * #4929: `tools/run-tests.sh --only <file>...` runs the named test files with the suite's environment and guards
 * (the dead-port phone-home URLs, the fake gh and vercel, the unsets, the per-run temp root, the --require guards),
 * without the whole suite and without its queue. A bare `node --test <file>` has none of it.
 *
 * The probe files are written OUTSIDE the repo (a *.test.js inside it would change the whole-suite count), and run
 * through the real runner.
 *
 *   node --test tools.run-tests-only-4929.test.js
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RUNNER = path.join(__dirname, 'tools', 'run-tests.sh');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'only-4929-'));
/* This file runs under node --test, which marks its children with NODE_TEST_CONTEXT; a nested node --test that
   inherits it reports to this one instead of printing. The runs below are separate runs, so it goes. */
const cleanEnv = (extra = {}) => { const e = { ...process.env, ...extra }; delete e.NODE_TEST_CONTEXT; return e; };

/* What a test sees of its environment, written as one JSON line. */
const PROBE = path.join(DIR, 'envprobe.test.js');
fs.writeFileSync(PROBE, `'use strict';
const test = require('node:test');
test('probe', () => {
  const e = process.env;
  console.log('ENV ' + JSON.stringify({
    created: e.AGENT_WORKFORCE_CREATED_URL || null,
    community: e.AGENT_WORKFORCE_COMMUNITY_URL || null,
    gh: e.AGENT_WORKFORCE_GH_BIN || null,
    legacy: e.KOSMOS_NO_LEGACY_MIGRATION || null,
    codexHome: e.CODEX_HOME || null,
    tokenOnly: e.KOSMOS_AGENT_TOKEN_ONLY || null,
    tmpdir: e.TMPDIR || null,
    guards: process.execArgv.join(' '),
  }));
});
`);
const RED = path.join(DIR, 'red.test.js');
fs.writeFileSync(RED, `'use strict';\nrequire('node:test')('red', () => { throw new Error('red on purpose'); });\n`);

function run(args, extraEnv = {}) {
  const env = cleanEnv({ CODEX_HOME: '/tmp/should-be-unset', KOSMOS_AGENT_TOKEN_ONLY: '1', ...extraEnv });
  delete env.KOSMOS_TEST_PART;
  const r = spawnSync('bash', [RUNNER, ...args], { env, encoding: 'utf8', timeout: 120000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

test('CONTROL: a bare node --test has none of the suite\'s environment (what --only exists to fix)', () => {
  const r = spawnSync(process.execPath, ['--test', PROBE], { env: cleanEnv({ CODEX_HOME: '/tmp/should-be-unset' }), encoding: 'utf8' });
  const line = ((r.stdout || '').match(/ENV (\{.*\})/) || [])[1];
  assert.ok(line, 'the probe printed nothing: ' + r.stdout);
  const e = JSON.parse(line);
  assert.notEqual(e.created, 'http://127.0.0.1:9/api/created', 'a bare run already points the beacon at a dead port, so this test proves nothing');
});

test('--only runs the named file with the suite\'s environment and guards', () => {
  const r = run(['--only', PROBE]);
  assert.equal(r.code, 0, r.out.slice(-1500));
  assert.match(r.out, /--only: 1 named file\(s\), not the whole suite/);
  const e = JSON.parse((r.out.match(/ENV (\{.*\})/) || [])[1] || 'null');
  assert.ok(e, 'the probe did not run: ' + r.out.slice(-800));
  assert.equal(e.created, 'http://127.0.0.1:9/api/created', 'the install beacon is not pointed at a dead port');
  assert.equal(e.community, 'http://127.0.0.1:9/');
  assert.match(String(e.gh), /test-support\/fake-cli-signed-out\.sh$/);
  assert.equal(e.legacy, '1');
  assert.equal(e.codexHome, null, 'an inherited CODEX_HOME reached the test');
  assert.equal(e.tokenOnly, null, 'an inherited KOSMOS_AGENT_TOKEN_ONLY reached the test');
  assert.match(String(e.tmpdir), /\/kt\d+$/, 'the test did not get the per-run temp root');
  assert.match(e.guards, /launch-guard\.js/);
  assert.match(e.guards, /tool-guard\.js/);
  assert.match(r.out, /tests 1\b/, 'more than the named file ran');
});

test('--only passes a red file\'s failure on', () => {
  const r = run(['--only', RED]);
  assert.notEqual(r.code, 0, 'a failing file came back green');
  assert.match(r.out, /red on purpose/);
});

test('--only refuses, before anything runs: no files, an option, a non-test file, a missing file, with a part', () => {
  for (const [args, env, why] of [
    [['--only'], {}, /needs one or more test files/],
    [['--only', '--test-name-pattern=x'], {}, /takes test files, not node --test options/],
    [['--only', path.join(DIR, 'notes.txt')], {}, /takes \*\.test\.js files/],
    [['--only', path.join(DIR, 'missing.test.js')], {}, /no test file/],
    [['--only', PROBE], { KOSMOS_TEST_PART: 'node', KOSMOS_TEST_PART_LOCAL: '1' }, /does not take KOSMOS_TEST_PART/],
  ]) {
    const e = cleanEnv(env);
    const r = spawnSync('bash', [RUNNER, ...args], { env: e, encoding: 'utf8', timeout: 60000 });
    const out = (r.stdout || '') + (r.stderr || '');
    assert.equal(r.status, 2, JSON.stringify(args) + ': ' + out.slice(-400));
    assert.match(out, why, JSON.stringify(args));
    assert.doesNotMatch(out, /ENV \{/, 'the probe ran although the arguments were refused');
  }
});

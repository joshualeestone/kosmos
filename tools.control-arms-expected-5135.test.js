'use strict';
/* kosmos#5135: the mobile-shots leak and cover control arms in tools/browser-checks.sh. When an arm passes, the
 * planted "FAIL  " lines its run printed must reach the cut log as "CONTROL (expected): ", so nobody chases them as
 * reds. When an arm does NOT pass, its output must print untouched, so a real red still reads as one. This lifts each
 * arm's real bash -c body out of the script and runs it with a stand-in `node` on PATH, so no browser is needed. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SRC = fs.readFileSync(path.join(__dirname, 'tools', 'browser-checks.sh'), 'utf8');

/* The body of the bash -c that follows `run_one "<label>..."`, up to its closing quote. */
function armBody(label) {
  const at = SRC.indexOf(`run_one "${label}`);
  assert.ok(at > 0, `no run_one for ${label} in browser-checks.sh`);
  const open = SRC.indexOf("bash -c '", at) + "bash -c '".length;
  const close = SRC.indexOf("' \\\n", open);
  assert.ok(open > at && close > open, `could not lift the bash -c body for ${label}`);
  const body = SRC.slice(open, close);
  assert.match(body, /exit 1$/, `the lifted body for ${label} does not end at its own exit 1`);
  return body;
}

/* Run a body with a fake node that prints `lines` to stderr and exits `rc`. */
function runArm(body, args, lines, rc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl5135-'));
  const fake = path.join(dir, 'node');
  fs.writeFileSync(fake, `#!/bin/bash\ncat >&2 <<'OUT'\n${lines.join('\n')}\nOUT\nexit ${rc}\n`);
  fs.chmodSync(fake, 0o755);
  try {
    return spawnSync('bash', ['-c', body, '_', ...args, path.join(dir, 'out')],
      { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const LEAK = 'FAIL  mobile-shots: LEAK GUARD: the throwaway board lists 1 account(s); a sealed board must list none.';
const COVER = 'FAIL  mobile-shots: 1 shot(s) could not be taken; see the ERROR lines above';
const COVER_MSG = 'the Allow button is not seen: covered by div#cover-control';

test('a leak arm that fires prints its planted FAIL as CONTROL (expected) and passes', () => {
  const r = runArm(armBody('mobile-shots-leak-'), ['account', 'the throwaway board lists'], [LEAK], 3);
  assert.equal(r.status, 0, r.stdout);
  assert.doesNotMatch(r.stdout, /^FAIL /m);
  assert.match(r.stdout, /^CONTROL \(expected\): mobile-shots: LEAK GUARD: the throwaway board lists/m);
  assert.match(r.stdout, /stopped with exit 3 by its own guard, as it must/);
});

test('a leak arm whose guard does not fire keeps the raw FAIL lines and reds', () => {
  // exit 3 but the other arm's message: the case match must still refuse it.
  const r = runArm(armBody('mobile-shots-leak-'), ['page', 'this screen shows real data'], [LEAK], 3);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^FAIL  mobile-shots: LEAK GUARD/m);
  assert.doesNotMatch(r.stdout, /CONTROL \(expected\)/);
  assert.match(r.stdout, /^FAIL  leak control page: exit 3/m);
});

test('a cover arm that fires relabels its FAIL lines and passes', () => {
  const r = runArm(armBody('mobile-shots-cover-'), ['overlay', 'allow-card', COVER_MSG], [`row: ERROR ${COVER_MSG}`, COVER], 2);
  assert.equal(r.status, 0, r.stdout);
  assert.doesNotMatch(r.stdout, /^FAIL /m);
  assert.match(r.stdout, /^CONTROL \(expected\): mobile-shots: 1 shot\(s\) could not be taken/m);
});

test('a cover arm that exits clean keeps its output raw and reds', () => {
  const r = runArm(armBody('mobile-shots-cover-'), ['spill', 'allow-card', 'the code does not fit its card'], ['FAIL  something real'], 0);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^FAIL  something real/m);
  assert.match(r.stdout, /^FAIL  control spill: exit 0/m);
  assert.doesNotMatch(r.stdout, /CONTROL \(expected\)/);
});

test('a passing leak arm relabels only its own planted line; another FAIL stays raw', () => {
  const r = runArm(armBody('mobile-shots-leak-'), ['account', 'the throwaway board lists'], ['FAIL  something unrelated', LEAK], 3);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^FAIL  something unrelated$/m);
  assert.match(r.stdout, /^CONTROL \(expected\): mobile-shots: LEAK GUARD: the throwaway board lists/m);
});

test('a passing cover arm relabels only its summary line; another FAIL stays raw', () => {
  const r = runArm(armBody('mobile-shots-cover-'), ['overlay', 'allow-card', COVER_MSG], [`row: ERROR ${COVER_MSG}`, 'FAIL  something unrelated', COVER], 2);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^FAIL  something unrelated$/m);
  assert.match(r.stdout, /^CONTROL \(expected\): mobile-shots: 1 shot\(s\) could not be taken/m);
});

test('a cover arm with the right exit but the other arm\'s message keeps its output raw and reds', () => {
  const r = runArm(armBody('mobile-shots-cover-'), ['spill', 'allow-card', 'the code does not fit its card'], [`row: ERROR ${COVER_MSG}`, COVER], 2);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^FAIL  mobile-shots: 1 shot\(s\) could not be taken/m);
  assert.match(r.stdout, /^FAIL  control spill: exit 2/m);
  assert.doesNotMatch(r.stdout, /CONTROL \(expected\)/);
});

test('a passing cover arm relabels its summary line whatever the shot count', () => {
  const two = COVER.replace('1 shot(s)', '2 shot(s)');
  const r = runArm(armBody('mobile-shots-cover-'), ['overlay', 'allow-card', COVER_MSG], [`row: ERROR ${COVER_MSG}`, two], 2);
  assert.equal(r.status, 0, r.stdout);
  assert.doesNotMatch(r.stdout, /^FAIL /m);
  assert.match(r.stdout, /^CONTROL \(expected\): mobile-shots: 2 shot\(s\) could not be taken/m);
});

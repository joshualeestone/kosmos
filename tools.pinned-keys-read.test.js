'use strict';

/**
 * #6468 (0.7.57 cut, failed at step 4): tools/build-kosmos-bundle.sh reads the keys the bundle pins (pinned_keys, the
 * keys installs of this build accept) with the bundle's own node. STAGE is the RELATIVE path dist/kosmos-bundle, and
 * `require("dist/...")` is a package lookup, not a file, so the read failed only inside a cut; a hand test with an
 * absolute path passed. This test runs the build's OWN lines, lifted out of the script, with the relative STAGE a
 * real build uses, from a temporary folder.
 *
 *   node --test tools.pinned-keys-read.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BUILD = fs.readFileSync(path.join(__dirname, 'tools', 'build-kosmos-bundle.sh'), 'utf8');
const VERIFIER = path.join(__dirname, 'engine', 'manifest-verify.js');

/** The build's lines from the pinned-key read to its refusal, verbatim. */
function readLines() {
  const lines = BUILD.split('\n');
  const start = lines.findIndex((l) => /^_pk_file=/.test(l));
  const end = lines.findIndex((l, i) => i > start && /^rm -f "\$_pk_err"$/.test(l));
  assert.ok(start > 0 && end > start, 'the pinned-key read moved in tools/build-kosmos-bundle.sh; re-anchor this test');
  assert.match(lines.slice(start, end + 1).join('\n'), /KM_PINNED_KEYS=/, 'the lifted lines do not set KM_PINNED_KEYS');
  return lines.slice(start, end + 1).join('\n');
}

/** A cwd holding dist/kosmos-bundle as a build leaves it: runtime/bin/node and app/engine/manifest-verify.js. */
function stageIn(cwd) {
  const stage = path.join(cwd, 'dist', 'kosmos-bundle');
  fs.mkdirSync(path.join(stage, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(stage, 'app', 'engine'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(stage, 'runtime', 'bin', 'node'));
  fs.copyFileSync(VERIFIER, path.join(stage, 'app', 'engine', 'manifest-verify.js'));
  return stage;
}
function run(cwd, lines, stageValue) {
  const script = ['set -euo pipefail', `STAGE=${JSON.stringify(stageValue)}`, lines, 'printf "keys=%s\\n" "$KM_PINNED_KEYS"'].join('\n');
  return spawnSync('/bin/bash', ['-c', script], { cwd, encoding: 'utf8' });
}

let tmp;
test.before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-pinned-keys-')); });
test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

test('the build reads the pinned keys with the RELATIVE stage a real build uses (the 0.7.57 cut failure)', () => {
  const cwd = fs.mkdtempSync(path.join(tmp, 'rel-'));
  stageIn(cwd);
  const r = run(cwd, readLines(), 'dist/kosmos-bundle');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const keys = JSON.parse(/keys=(.*)/.exec(r.stdout)[1]);
  assert.deepEqual(keys, require(VERIFIER).KEYS);
});

test('CONTROL: the line as it was in the 0.7.57 freeze fails on the same relative stage (the test can see the bug)', () => {
  const cwd = fs.mkdtempSync(path.join(tmp, 'old-'));
  stageIn(cwd);
  const old = `KM_PINNED_KEYS="$("$STAGE/runtime/bin/node" -e 'process.stdout.write(JSON.stringify(require(process.argv[1]).KEYS))' "$STAGE/app/engine/manifest-verify.js" 2>/dev/null)" || KM_PINNED_KEYS=""`;
  const r = run(cwd, old, 'dist/kosmos-bundle');
  assert.match(r.stdout, /keys=\n?$/m, 'the old line read the keys from a relative stage, so this control cannot see the bug: ' + r.stdout);
});

test('a stage whose verifier will not load refuses the build AND shows why (the cause is no longer dropped)', () => {
  const cwd = fs.mkdtempSync(path.join(tmp, 'bad-'));
  const stage = stageIn(cwd);
  fs.writeFileSync(path.join(stage, 'app', 'engine', 'manifest-verify.js'), 'module.exports = { KEYS: [] }; throw new Error("planted load failure");\n');
  const r = run(cwd, readLines(), 'dist/kosmos-bundle');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /could not read the pinned keys/);
  assert.match(r.stderr, /planted load failure/, 'the node error is shown, not dropped');
});

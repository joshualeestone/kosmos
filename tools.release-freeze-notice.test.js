'use strict';

/**
 * The freeze notice tells a colleague deciding whether to merge what is true (#1369, #6130).
 *
 * 🛑 #6130: IT USED TO SAY "MERGING TO MAIN IS SAFE FROM NOW ON". That holds only for a cut that
 * finishes first time. A cut that aborts and is redone freezes CURRENT main, so anything merged in
 * between rides the re-cut untested: 0.7.19 took a third cut when #5063 rode one. The team holds
 * merges until the cut's version serves. On 2026-10-13 an agent read the old banner, told the PM no
 * hold was needed, and had to be corrected. A prose rule loses to a tool that prints the opposite.
 *
 * ⚠️ #1369's lesson still stands: a hold with no stated end silently became "never merge" on
 * 2026-08-28. So the notice names the version and the channel, which is when the hold lifts.
 *
 * The message is the deliverable, and it is a function rather than an inline echo so something can
 * hold it to that.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const LIB = path.join(__dirname, 'tools', 'lib', 'release-freeze.sh');
const RELEASE = path.join(__dirname, 'tools', 'release.sh');
const SHA = '70babd154c6ed3e8e0cf82f8482713d7cf6b6ea7';

function notice(...args) {
  const quoted = args.map((a) => `'${String(a).replace(/'/g, `'\\''`)}'`).join(' ');
  const r = spawnSync('bash', ['-c', `. "${LIB}"; release_freeze_notice ${quoted}`], { encoding: 'utf8' });
  return { out: r.stdout || '', err: r.stderr || '', status: r.status };
}

test('#6130: the notice holds merges until the version serves, and never calls merging safe', () => {
  const r = notice(SHA, '/tmp/kosmos-build-x', '0.7.48', 'staging');
  assert.equal(r.status, 0, r.err);
  const flat = r.out.replace(/\s+/g, ' ');
  assert.match(flat, /HOLD MERGES TO MAIN until 0\.7\.48 serves on staging/,
    'it does not tell a colleague to hold merges, or not until WHICH version serves WHERE');
  assert.match(flat, /re-cut freezes CURRENT main/, 'it does not say why: a redo freezes current main');
  assert.match(flat, /NOT in this attempt at 0\.7\.48/, 'it does not say a merge from here misses this attempt');
  assert.match(flat, /or the cutter calls this cut off/,
    'the hold has no end for an abandoned cut, which is the #1369 never-merge failure');
  // The old promise, by every spelling it had. Each would let a reader decide no hold is needed.
  assert.doesNotMatch(flat, /safe/i, 'it still calls merging safe');
  assert.doesNotMatch(flat, /no merge freeze/i, 'it still denies the hold');
});

test('#6130: a prod cut says prod, so the hold ends where that cut actually serves', () => {
  const flat = notice(SHA, '/tmp/kosmos-build-x', '0.7.49', 'prod').out.replace(/\s+/g, ' ');
  assert.match(flat, /until 0\.7\.49 serves on prod/);
  assert.doesNotMatch(flat, /staging/, 'a prod cut names staging');
});

test('it names the frozen sha and the build, so the claim is checkable', () => {
  const r = notice(SHA, '/tmp/kosmos-build-x', '0.7.48', 'staging');
  assert.match(r.out, /70babd154c6e/, 'the notice does not name the sha it froze at');
  assert.match(r.out, /\/tmp\/kosmos-build-x/, 'the notice does not name where it is building');
});

test('it refuses rather than printing a hold with a hole in it', () => {
  /* ⚠️ "Hold until  serves on " is a hold with no end, which is the #1369 failure. Missing
     arguments must fail, not degrade. */
  for (const args of [[], [SHA], ['', '/tmp/x', '0.7.48', 'staging'], [SHA, '/tmp/x'],
    [SHA, '/tmp/x', '0.7.48'], [SHA, '/tmp/x', '', 'staging'], [SHA, '/tmp/x', '0.7.48', '']]) {
    const r = notice(...args);
    assert.notEqual(r.status, 0, `it printed a notice with missing arguments: ${JSON.stringify(args)}`);
    assert.equal(r.out, '', `it printed part of a notice with missing arguments: ${JSON.stringify(args)}`);
  }
});

test('#6130: release.sh passes all four arguments, because a short call kills the cut under set -e', () => {
  const calls = fs.readFileSync(RELEASE, 'utf8').split('\n')
    .filter((l) => /^\s*release_freeze_notice\b/.test(l));
  assert.equal(calls.length, 1, `expected one call in tools/release.sh, found ${calls.length}`);
  assert.equal(calls[0].trim(), 'release_freeze_notice "$SHA" "$BUILD" "$V" "$CUT_CHANNEL"');
  // And those are the names release.sh really gives the version and the channel.
  const src = fs.readFileSync(RELEASE, 'utf8');
  assert.match(src, /^V="\$\{1:-\}"$/m, 'the version is no longer $V');
  assert.match(src, /^CUT_CHANNEL="\$\{KOSMOS_CUT_CHANNEL:-prod\}"$/m, 'the channel is no longer $CUT_CHANNEL');
});

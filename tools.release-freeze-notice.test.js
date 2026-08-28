'use strict';

/**
 * The freeze notice says what it means FOR THE FLEET (#1369).
 *
 * 🛑 WHY THIS IS A TEST AND NOT JUST A BETTER SENTENCE. On 2026-08-28 a merge
 * freeze was announced that does not exist and retracted four minutes later;
 * the retraction arrived truncated. Five PRs sat for an hour with nothing
 * blocking them, and it was the answer to the operator asking why he was seeing
 * no updates. The rule "wait for no cut" had silently inverted into "never
 * merge" the moment cuts began running back to back.
 *
 * The fact that would have unblocked everybody was already printed by the cut,
 * as "a pull into <repo> from now on changes nothing below" - true, correct, and
 * about the CUTTER'S tree rather than about whether a colleague may merge.
 *
 * ⭐ The fix is deliberately NOT a lock or a cut-in-progress flag. Either would
 * make the wrong belief TRUE and nobody would question it again, because the
 * tool would be enforcing it. Merges are always safe; this says so.
 *
 * So the message is the deliverable, and it is a function rather than an inline
 * echo precisely so that something can hold it to that.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const LIB = path.join(__dirname, 'tools', 'lib', 'release-freeze.sh');

function notice(...args) {
  const quoted = args.map((a) => `'${String(a).replace(/'/g, `'\\''`)}'`).join(' ');
  const r = spawnSync('bash', ['-c', `. "${LIB}"; release_freeze_notice ${quoted}`], { encoding: 'utf8' });
  return { out: r.stdout || '', err: r.stderr || '', status: r.status };
}

test('the freeze notice says merging is safe, in words a colleague can act on', () => {
  const r = notice('70babd154c6ed3e8e0cf82f8482713d7cf6b6ea7', '/tmp/kosmos-build-x');
  assert.equal(r.status, 0);
  assert.match(r.out, /MERGING TO MAIN IS SAFE/,
    'the notice does not tell anybody that merging is safe, which is its only job');
  assert.match(r.out, /no merge freeze/i,
    'it does not deny the freeze by name, and the false belief is what cost the hour');
});

test('it names the frozen sha and the build, so the claim is checkable', () => {
  /* 🔑 "Merging is safe" is only actionable if you can see WHICH cut is making
     the promise. A reassurance with no sha is a slogan. */
  const r = notice('70babd154c6ed3e8e0cf82f8482713d7cf6b6ea7', '/tmp/kosmos-build-x');
  assert.match(r.out, /70babd154c6e/, 'the notice does not name the sha it froze at');
  assert.match(r.out, /\/tmp\/kosmos-build-x/, 'the notice does not name where it is building');
});

test('it refuses rather than printing a promise with a hole in it', () => {
  /* ⚠️ THE ARM THAT MATTERS, and it is the reason this is not a grep for a
     string. A notice that printed "frozen at , building in " would still
     satisfy both assertions above while promising safety on behalf of a cut it
     cannot name. Missing arguments must fail, not degrade. */
  for (const args of [[], ['70babd15'], ['', '/tmp/x']]) {
    const r = notice(...args);
    assert.notEqual(r.status, 0, `it printed a notice with missing arguments: ${JSON.stringify(args)}`);
    assert.ok(!/MERGING TO MAIN IS SAFE/.test(r.out),
      `it promised merges are safe with missing arguments: ${JSON.stringify(args)}`);
  }
});

'use strict';

/**
 * The zip-contents guard, EXERCISED rather than read.
 *
 *   node --test tools.build-windows-guard-runs.test.js
 *
 * 🛑 WHY THIS FILE EXISTS, AND IT IS NOT A HYPOTHETICAL. On 2026-08-29 the guard
 * on `Kosmos.cmd` COULD NOT FAIL, and every existing test stayed green through
 * it, because `tools.build-windows-570.test.js` greps the builder's SOURCE and
 * never runs the match.
 *
 * ⭐ IT TOOK TWO CHANGES BY TWO PEOPLE, HOURS APART, AND NEITHER WAS WRONG ALONE:
 *
 *     Pete    replaced `grep " $want$"` with `case "$LISTING" in *" $want"*)`
 *             while fixing a pipefail bug, DROPPING THE LINE-END ANCHOR
 *     Renet   added "Install Kosmos.cmd" to the bundle
 *
 * An unanchored match with no colliding name is harmless. A colliding name
 * against an anchored match is harmless. **Together, `" Kosmos.cmd"` matched
 * inside `"Install Kosmos.cmd"`**, and a zip built with every required entry
 * EXCEPT the primary launcher passed all nine checks.
 *
 * ⇒ **A test that reads a guard's TEXT cannot tell you the guard stopped
 * working.** This one takes the construct out of the builder and RUNS it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const SRC = fs.readFileSync('tools/build-kosmos-windows.sh', 'utf8');

/**
 * The real loop, lifted from the builder.
 *
 * 🔑 EXTRACTED RATHER THAN COPIED, deliberately. A copy of the construct in this
 * file would go stale the moment somebody edits the builder, and would then be
 * testing a guard that no longer exists, which is the same defect one level up.
 */
function contentsLoop() {
  const at = SRC.indexOf('for want in "Kosmos.cmd"');
  assert.ok(at > -1, 'the contents loop moved or was renamed; restate this pin');
  const end = SRC.indexOf('\ndone', at);
  assert.ok(end > at, 'the contents loop has no terminating done; restate this pin');
  return SRC.slice(at, end + '\ndone'.length);
}

/**
 * Run the lifted loop against a synthetic set of names.
 *
 * 🔑 BOTH SHAPES ARE SUPPLIED, and that is what makes the result readable. The
 * loop has been written against `NAMES` (bare, one per line, from `unzip -Z1`)
 * and against `LISTING` (the formatted `unzip -l` output, with size and date
 * columns). Feeding only one shape makes the OTHER construct refuse everything,
 * so a red result would say "this construct is weak" and "you fed it the wrong
 * thing" in the same breath, and a reader could not tell which.
 * ⇒ Supply both, faithfully, and a failure means the guard, not the harness.
 */
function runAgainst(names) {
  const arr = names.split('\n').filter(Boolean);
  const listing = ['Archive:  x.zip', '  Length      Date    Time    Name',
    '---------  ---------- -----   ----']
    .concat(arr.map((n) => '      123  08-29-2026 16:00   ' + n))
    .concat(['---------                     -------', '      123                     ' + arr.length + ' files'])
    .join('\n');
  const script = [
    'set -u',
    'refuse() { echo "REFUSED: $1" >&2; exit 1; }',
    'NAMES=' + JSON.stringify(names).replace(/\\n/g, '\n'),
    'LISTING=' + JSON.stringify(listing).replace(/\\n/g, '\n'),
    contentsLoop(),
    'echo PASSED',
  ].join('\n');
  try {
    const out = execFileSync('bash', ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, out };
  } catch (err) {
    return { ok: false, out: String((err.stderr || '') + (err.stdout || '')) };
  }
}

/* Every name the loop currently demands, read out of the loop itself rather
   than restated, so this file cannot disagree with the builder about the list. */
function wanted() {
  const line = contentsLoop().split('\n')[0];
  return [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test('CONTROL: a complete listing passes', () => {
  /* Without this, a guard that refuses everything would satisfy every other
     assertion in the file. */
  const r = runAgainst(wanted().join('\n'));
  assert.ok(r.ok, 'a listing with every required name was refused: ' + r.out);
});

test('🛑 a listing missing Kosmos.cmd is REFUSED, even when Install Kosmos.cmd is present', () => {
  /* THE EXACT SHAPE THAT SHIPPED GREEN. `" Kosmos.cmd"` is a substring of
     `"Install Kosmos.cmd"`, so an unanchored match cannot tell them apart. */
  const names = wanted().filter((n) => n !== 'Kosmos.cmd');
  assert.ok(names.includes('Install Kosmos.cmd'),
    'the bundle no longer carries the colliding name, so this test proves nothing; '
    + 'keep it anyway, or replace the collision with whatever the new one is');
  const r = runAgainst(names.join('\n'));
  assert.equal(r.ok, false,
    'THE GUARD ON THE PRIMARY LAUNCHER CANNOT FAIL: a zip without Kosmos.cmd passed');
  assert.match(r.out, /Kosmos\.cmd/, 'it refused, but did not say which file was missing');
});

test('every required name is individually enforced, one at a time', () => {
  /* 🔑 NOT ONE SPOT CHECK. Removing a single name must fail for EACH name, or a
     guard can be disarmed for one entry while the others keep the file green,
     which is exactly what happened. */
  const all = wanted();
  assert.ok(all.length >= 7, 'the wanted list looks truncated: ' + all.join(', '));
  const survived = [];
  for (const drop of all) {
    const r = runAgainst(all.filter((n) => n !== drop).join('\n'));
    if (r.ok) survived.push(drop);
  }
  assert.deepEqual(survived, [],
    'these names can go missing without the build refusing: ' + survived.join(', '));
});

test('a name that is a SUBSTRING of another cannot satisfy it', () => {
  /* The general form of the defect, stated so it survives the specific pair. */
  const all = wanted();
  const pairs = [];
  for (const a of all) for (const b of all) if (a !== b && b.includes(a)) pairs.push([a, b]);
  for (const [shortName, longName] of pairs) {
    const r = runAgainst(all.filter((n) => n !== shortName).join('\n'));
    assert.equal(r.ok, false,
      '"' + longName + '" satisfies the check for "' + shortName + '"');
  }
  /* Recorded rather than asserted: if the bundle ever has no such pair, this
     test is vacuous and should be told so rather than passing quietly. */
  assert.ok(pairs.length > 0,
    'no required name is a substring of another any more, so this test is vacuous; '
    + 'it is kept because the bundle gained such a pair once and will again');
});

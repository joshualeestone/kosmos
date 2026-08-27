'use strict';

/**
 * The #1042 gate's VERDICT LOGIC, tested against the output shapes it will see.
 *
 * ⚠️ WHY THIS FILE EXISTS. The gate reads the selftest's output and decides two
 * things: whether to stop the cut, and WHOSE FAULT it is. The second is the one
 * that goes wrong quietly. Blaming a broken product for a build-box timeout
 * stops a release for nothing; exonerating a broken product because its output
 * happened to contain an ordinary English phrase ships the defect.
 *
 * ⭐ AND BOTH HAVE ALREADY HAPPENED HERE, in two consecutive commits:
 *   - the first version reported EVERY non-zero exit as a wrong comparison,
 *     including a SIGALRM and a missing binary;
 *   - the fix for that keyed its new arm on the bare words "proved nothing" and
 *     "row is gone", which any future row's free-text column could contain, so a
 *     real comparison failure could have been reported as a broken test.
 * The sibling gate has `tools.filepanel-gate.test.js` pinning exactly this, and
 * its comment says so. This gate had nothing, which is why the ordering comment
 * was wrong for two commits: nothing exercised it.
 *
 * The block is EXTRACTED FROM THE REAL SCRIPT rather than copied, so it cannot
 * drift from what ships. If the markers move, this fails loudly rather than
 * silently testing a stale copy.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'tools', 'build-kosmos-bundle.sh');
/* ⚠️ A MARKER UNIQUE TO THIS GATE. "THE CAUSE DECIDES THE SENTENCE" appears in
   BOTH gates, so the first version of this file extracted the #1032 block and
   every test failed on `_fp_out: unbound variable` -- a red that says nothing
   about the code under test.
   ⚠️ AND IT MUST START AFTER THE LINE THAT RUNS THE BINARY. Anchoring on
   `_stale_rc=0` pulled in the `perl ... kosmos-app` assignment, so the block
   OVERWROTE the output this test had just set up and judged a real run instead
   of the fixture. The guards below catch both mistakes. */
const START = 'if [ "$_stale_rc" -ne 0 ]; then';
const END = 'it knows when it is the stale half';

function verdictBlock() {
  const src = fs.readFileSync(SCRIPT, 'utf8').split('\n');
  const from = src.findIndex((l) => l.includes(START));
  const to = src.findIndex((l) => l.includes(END));
  assert.ok(from > -1, `the #1042 gate's opening marker is gone from ${SCRIPT}; this test now checks nothing`);
  assert.ok(to > from, `the #1042 gate's closing marker is gone from ${SCRIPT}; this test now checks nothing`);
  const block = src.slice(from, to).join('\n');
  /* A control on the extraction itself: the sibling gate's variables must not
     appear, or we are testing the wrong block and would never know. */
  assert.ok(!/_fp_out|_fp_rc/.test(block),
    'the extracted block references the #1032 gate, so this is testing the wrong code');
  assert.ok(/_stale_out/.test(block), 'the extracted block does not mention _stale_out');
  assert.ok(!/perl |kosmos-app/.test(block),
    'the extracted block RUNS the binary, so it would overwrite the fixture and judge a real run');
  return block;
}

/** Runs the real block with a given selftest output and exit code. */
function verdict(out, rc) {
  const script = [
    'set -euo pipefail',
    '_stale_out=$(cat "$1")',
    '_stale_rc="$2"',
    verdictBlock(),
    'echo "VERDICT:pass"',
  ].join('\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stalegate-'));
  const file = path.join(dir, 'out.txt');
  fs.writeFileSync(file, out);
  try {
    return { ok: true, text: execFileSync('bash', ['-c', script, 'gate', file, String(rc)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { ok: false, text: String(e.stdout || '') + String(e.stderr || '') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const GOOD = 'PASS  0.5.71 vs 0.5.73 -> behind\nstale-check: all good, 21 checks';

test('the gate passes a clean run', () => {
  const v = verdict(GOOD, 0);
  assert.ok(v.ok, 'a passing selftest was refused:\n' + v.text);
  assert.match(v.text, /VERDICT:pass/);
});

test('a wrong comparison is reported as the product', () => {
  const v = verdict('PASS  a\nFAIL  b\nstale-check: 1 FAILED', 1);
  assert.ok(!v.ok);
  assert.match(v.text, /comparison is wrong/);
});

test('A TIMEOUT IS NOT BLAMED ON THE COMPARISON', () => {
  /* The selftest prints nothing before it could hang in this shape, and a
     SIGALRM is 142. The first version of this gate called that a wrong
     comparison and stopped the cut with a false accusation. */
  const v = verdict('', 142);
  assert.ok(!v.ok, 'a timeout must still stop the cut');
  assert.match(v.text, /did not finish/);
  assert.doesNotMatch(v.text, /comparison is wrong/);
});

test('a missing binary is not blamed on the comparison either', () => {
  const v = verdict('/bin/sh: no such file', 127);
  assert.ok(!v.ok);
  assert.match(v.text, /did not finish/);
  assert.doesNotMatch(v.text, /comparison is wrong/);
});

test('a gutted test population is reported as the TEST, not the product', () => {
  const v = verdict('stale-check: only 3 checks ran, so this proved nothing', 1);
  assert.ok(!v.ok);
  assert.match(v.text, /no longer testing anything/);
  assert.doesNotMatch(v.text, /comparison is wrong/);
});

test('wrong buttons are reported as the buttons, not the comparison', () => {
  const v = verdict('FAIL  buttons: Return reaches "Quit and Open Again"\n'
    + 'stale-check: the relaunch notice\'s buttons are wrong, which is not the version comparison', 1);
  assert.ok(!v.ok);
  assert.match(v.text, /no longer testing anything|buttons/);
  assert.doesNotMatch(v.text, /comparison is wrong/);
});

test('THE INTEGRITY ARM CANNOT BE SPOOFED BY ORDINARY ENGLISH', () => {
  /* 🛑 THE REGRESSION THIS FILE WAS WRITTEN FOR. The integrity arm once keyed on
     the bare words "proved nothing" and "row is gone". Every selftest row prints
     a free-text `why` column, so a future row could contain either, and a REAL
     comparison failure would then have been reported as a broken test and the
     product exonerated. */
  const v = verdict('FAIL  9.9.9 vs 0.0.1 -> unknown  a row that proved nothing about ordering\n'
    + 'stale-check: 1 FAILED', 1);
  assert.ok(!v.ok);
  assert.match(v.text, /comparison is wrong/,
    'a real comparison failure was exonerated because its wording contained "proved nothing"');
});

test('every arm printed but a non-zero exit is the GATE being broken', () => {
  const v = verdict(GOOD, 3);
  assert.ok(!v.ok, 'the gate passed a run that printed everything and still failed');
});

test('the exit status alone cannot make the gate pass', () => {
  const v = verdict('PASS  0.5.71 vs 0.5.73 -> behind', 0);
  assert.ok(!v.ok, 'the gate went green on an exit code with no verdict behind it');
});

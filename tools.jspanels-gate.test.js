'use strict';

/**
 * The #3309 JS-dialog gate's VERDICT LOGIC, tested against the output shapes it
 * will actually see.
 *
 * WHY THIS FILE EXISTS. The gate in tools/build-kosmos-bundle.sh reads the
 * --kosmos-app-jspanels-selftest output and decides two things: whether to stop
 * the cut, and WHOSE FAULT it is. Getting the second wrong is not cosmetic:
 * blaming the product for a build-box timeout stops a release for nothing;
 * exonerating the product for a real regression ships a Mac app that drops board
 * confirm() dialogs (or, worse, inverts OK/Cancel so a destructive confirm
 * silently proceeds). Its two sibling gates (#1032, #1042) each ship a companion
 * verdict test for exactly this reason, and this repo has TWICE shipped a
 * silently-wrong case/esac ordering in this kind of block; this pins ours so a
 * future arm-reorder is caught rather than rediscovered.
 *
 * The block is EXTRACTED FROM THE REAL SCRIPT by its markers rather than copied,
 * so the test cannot drift from what ships. If the markers move, this fails
 * loudly rather than silently testing a stale copy.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'tools', 'build-kosmos-bundle.sh');
const START = '#3309 GATE - THE VERDICT IS THE OUTPUT, NOT THE EXIT STATUS';
const END = 'Treat that as the #3309 gate being broken, not as a pass.';

function verdictBlock() {
  const src = fs.readFileSync(SCRIPT, 'utf8').split('\n');
  const from = src.findIndex((l) => l.includes(START));
  const to = src.findIndex((l) => l.includes(END));
  assert.ok(from > -1, `the #3309 verdict block's opening marker is gone from ${SCRIPT}; this test is now checking nothing`);
  assert.ok(to > from, `the #3309 verdict block's closing marker is gone from ${SCRIPT}; this test is now checking nothing`);
  return src.slice(from, to + 1).join('\n');
}

/** Runs the real block with a given selftest output and exit code. */
function verdict(out, rc) {
  const script = [
    'set -euo pipefail',
    '_js_out=$(cat "$1")',
    '_js_rc="$2"',
    verdictBlock(),
    'echo "VERDICT:pass"',
  ].join('\n');
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'jsgate-'));
  const outFile = path.join(tmp, 'out.txt');
  fs.writeFileSync(outFile, out);
  try {
    const stdout = execFileSync('bash', ['-c', script, 'gate', outFile, String(rc)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, text: stdout };
  } catch (e) {
    return { ok: false, text: String(e.stdout || '') + String(e.stderr || '') };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// The real shapes, exactly as the hatch prints them (kept in sync with the
// --kosmos-app-jspanels-selftest arms and the gate's _js_want list).
const GOOD = [
  'uiDelegate:set',
  'mapping:confirm-ok-true:yes',
  'mapping:confirm-cancel-false:yes',
  'mapping:prompt-ok-text:yes',
  'mapping:prompt-cancel-nil:yes',
  'buttons:confirm-ok-first:yes',
  'buttons:prompt-ok-first:yes',
  'delegate-fired:alert:yes',
  'delegate-fired:confirm:yes',
  'delegate-fired:prompt:yes',
  'return-value:confirm-true:yes',
  'return-value:prompt-typed:yes',
].join('\n');

test('the gate passes the output a working JS-dialog delegate produces', () => {
  const v = verdict(GOOD, 0);
  assert.ok(v.ok, 'a fully-passing selftest was refused:\n' + v.text);
  assert.match(v.text, /VERDICT:pass/);
});

test('a dropped dialog (a delegate-fired arm missing) is reported as the product', () => {
  const v = verdict(GOOD.replace('delegate-fired:confirm:yes', 'delegate-fired:confirm:no'), 1);
  assert.ok(!v.ok, 'the gate passed a build whose confirm() delegate never fires');
  assert.match(v.text, /JS-dialog handling is wrong/);
  assert.match(v.text, /delegate-fired:confirm:yes/, 'the message must name the arm that did not hold');
});

test('an INVERTED mapping (Cancel acting as OK) is reported as the product', () => {
  // The exact silent-inversion hazard the pure-mapping + buttons arms exist for.
  const v = verdict(GOOD.replace('mapping:confirm-cancel-false:yes', 'mapping:confirm-cancel-false:no'), 1);
  assert.ok(!v.ok, 'the gate passed a build whose confirm() maps Cancel to true');
  assert.match(v.text, /JS-dialog handling is wrong/);
  assert.match(v.text, /mapping:confirm-cancel-false:yes/);
});

test('a swapped button order (OK not first) is reported as the product', () => {
  const v = verdict(GOOD.replace('buttons:confirm-ok-first:yes', 'buttons:confirm-ok-first:no'), 1);
  assert.ok(!v.ok);
  assert.match(v.text, /JS-dialog handling is wrong/);
  assert.match(v.text, /buttons:confirm-ok-first:yes/);
});

test('A HANG IS NOT BLAMED ON THE PRODUCT, even though it prints uiDelegate first', () => {
  // The hatch's watchdog can only fire after uiDelegate: has printed, so with the
  // arms tested in the wrong order this shape would match the product branch and
  // stop a cut with a false accusation. TIMED OUT must be tested FIRST.
  const v = verdict(['uiDelegate:set', 'jspanels selftest TIMED OUT: watchdog'].join('\n'), 1);
  assert.ok(!v.ok, 'a hang must still stop the cut');
  assert.match(v.text, /did not finish/);
  assert.doesNotMatch(v.text, /JS-dialog handling is wrong/,
    'a hang was blamed on the product: the timeout arm must be tested before the product arm');
});

test('the gate never getting going (empty output) is NOT a verdict on the product', () => {
  const v = verdict('', 127);
  assert.ok(!v.ok, 'a gate that never ran must still stop the cut');
  assert.match(v.text, /never ran/);
  assert.doesNotMatch(v.text, /JS-dialog handling is wrong/,
    'a gate that printed no arms was blamed on the product');
});

test('every arm present but a non-zero exit is the gate being broken, not a pass', () => {
  const v = verdict(GOOD, 3);
  assert.ok(!v.ok, 'the gate passed on a non-zero exit despite every arm printing');
  assert.match(v.text, /gate being broken/);
});

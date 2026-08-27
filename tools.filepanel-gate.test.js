'use strict';

/**
 * The #1032 file-picker gate's VERDICT LOGIC, tested against the output shapes
 * it will actually see.
 *
 * ⚠️ WHY THIS FILE EXISTS. The gate reads the selftest's output and decides two
 * things: whether to stop the cut, and WHOSE FAULT it is. Getting the second
 * wrong is not cosmetic. Blaming the product for a missing binary stops a
 * release for nothing; exonerating the product for a real crash ships a build
 * that kills itself when somebody presses Cancel.
 *
 * ⭐ AND IT IS NOT HYPOTHETICAL. The first version of this logic tested the
 * product arm before the timeout arm. The hatch prints `uiDelegate:...` as its
 * very first statement, so EVERY run that can reach its own watchdog has
 * already printed it -- which meant a genuine hang matched the product arm and
 * was reported as "the + button will do nothing". The timeout branch was dead
 * code that read as a live guard. A review found it by building exactly this
 * harness; it now lives in the tree instead of in a transcript.
 *
 * The block is EXTRACTED FROM THE REAL SCRIPT rather than copied, so the test
 * cannot drift from what ships. If the markers move, this fails loudly rather
 * than silently testing a stale copy.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'tools', 'build-kosmos-bundle.sh');
const START = 'THE VERDICT IS THE OUTPUT, NOT THE EXIT STATUS';
const END = 'Treat that as the gate being broken, not as a pass.';

function verdictBlock() {
  const src = fs.readFileSync(SCRIPT, 'utf8').split('\n');
  const from = src.findIndex((l) => l.includes(START));
  const to = src.findIndex((l) => l.includes(END));
  assert.ok(from > -1, `the verdict block's opening marker is gone from ${SCRIPT}; this test is now checking nothing`);
  assert.ok(to > from, `the verdict block's closing marker is gone from ${SCRIPT}; this test is now checking nothing`);
  return src.slice(from, to + 1).join('\n');
}

/** Runs the real block with a given selftest output and exit code. */
function verdict(out, rc) {
  const script = [
    'set -euo pipefail',                 // the regime the real script runs under
    '_fp_out=$(cat "$1")',
    '_fp_rc="$2"',
    verdictBlock(),
    'echo "VERDICT:pass"',
  ].join('\n');
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'fpgate-'));
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

// The real shapes, tab-separated exactly as the hatch prints them.
const GOOD = [
  'uiDelegate:set',
  'navigationDelegate:set',
  'press:hidden-input\tasked-for-panel:yes',
  'press:visible-input\tasked-for-panel:yes',
  'press:real-presenter\tpanel-on-screen:yes',
  'press:after-a-cancel\treaches-the-app-again:yes',
].join('\n');

test('the gate passes the output a working file picker produces', () => {
  const v = verdict(GOOD, 0);
  assert.ok(v.ok, 'a fully-passing selftest was refused:\n' + v.text);
  assert.match(v.text, /VERDICT:pass/);
});

test('a missing uiDelegate is reported as the product, which is what it is', () => {
  const v = verdict(['uiDelegate:MISSING', 'navigationDelegate:set',
    'press:hidden-input\tasked-for-panel:no',
    'press:visible-input\tasked-for-panel:no'].join('\n'), 1);
  assert.ok(!v.ok, 'the gate passed a build whose + button is dead');
  assert.match(v.text, /file picker is broken/);
  assert.match(v.text, /uiDelegate:set/, 'the message must name the arm that did not hold');
});

test('a cancel that never answers is reported as the product, at the crash exit code', () => {
  /* The real shape: arms 1-3 print, then WebKit raises because the completion
     handler was not called and the process aborts at 134 before arm 4. */
  const v = verdict(GOOD.split('\n').slice(0, 5).join('\n'), 134);
  assert.ok(!v.ok);
  assert.match(v.text, /file picker is broken/);
  assert.match(v.text, /after-a-cancel/, 'the message must name the arm that did not hold');
});

test('A HANG IS NOT BLAMED ON THE PRODUCT, even though it prints uiDelegate first', () => {
  /* 🛑 THE REGRESSION THIS FILE WAS WRITTEN FOR. The hatch's watchdog can only
     fire after `uiDelegate:` has been printed, so with the arms tested in the
     wrong order this shape matched the product branch and stopped a cut with a
     false accusation. */
  const v = verdict(['uiDelegate:set', 'navigationDelegate:set',
    'filepanel selftest TIMED OUT'].join('\n'), 1);
  assert.ok(!v.ok, 'a hang must still stop the cut');
  assert.match(v.text, /did not finish/);
  assert.doesNotMatch(v.text, /file picker is broken/,
    'a hang was blamed on the + button: the timeout arm must be tested before the product arm');
});

test('the gate GIVING UP is not a verdict on the product', () => {
  /* 🛑 THE SHAPE THAT WAS SHIPPED WHILE FIXING THIS EXACT CLASS. The hatch
     polls for its probe page and gives up if the page never loads. The first
     version of that message did not carry the watchdog's token, so it matched
     the product arm and a busy build box was reported as "the + button will do
     nothing" -- which is the defect the poll was added to remove, reintroduced
     by the fix for it. */
  const v = verdict(['uiDelegate:set', 'navigationDelegate:set',
    'filepanel selftest TIMED OUT: the probe page never finished loading'].join('\n'), 1);
  assert.ok(!v.ok, 'a gate that could not finish must still stop the cut');
  assert.match(v.text, /did not finish/);
  assert.doesNotMatch(v.text, /file picker is broken/,
    'the gate giving up was reported as a broken + button');
});

test('the timeout arm cannot be spoofed by the words appearing in other output', () => {
  /* The timeout arm is tested FIRST, so a bare "TIMED OUT" substring would let
     any output containing those two words exonerate a genuinely broken build.
     It keys on the hatch's full unique phrase instead. */
  const v = verdict(['uiDelegate:MISSING',
    'press:hidden-input\tasked-for-panel:no',
    'some unrelated line that says TIMED OUT'].join('\n'), 1);
  assert.ok(!v.ok);
  assert.match(v.text, /file picker is broken/,
    'a real product break was exonerated because its output contained the words TIMED OUT');
});

test('a binary that never started is nobody\'s fault but the machine\'s', () => {
  const v = verdict('dyld[1]: Library not loaded', 127);
  assert.ok(!v.ok);
  assert.match(v.text, /never ran/);
  assert.doesNotMatch(v.text, /file picker is broken/);
});

test('every arm printed but a non-zero exit is the GATE being broken, not a pass', () => {
  const v = verdict(GOOD, 3);
  assert.ok(!v.ok, 'the gate passed a run that printed everything and still failed');
  assert.match(v.text, /gate being broken/);
});

test('the exit status alone cannot make the gate pass', () => {
  /* An early `exit(0)` in a future edit of the hatch is the failure this gate
     exists to replace: true, and proving nothing. */
  const v = verdict('uiDelegate:set\nnavigationDelegate:set', 0);
  assert.ok(!v.ok, 'the gate went green on an exit code with no evidence behind it');
});

test('spaces where the tabs should be do not pass', () => {
  /* The arms are matched with literal tabs. If the hatch ever prints spaces the
     gate must notice rather than quietly matching a substring. */
  const v = verdict(GOOD.replace(/\t/g, ' '), 0);
  assert.ok(!v.ok, 'the gate matched an arm whose separator had changed');
});
